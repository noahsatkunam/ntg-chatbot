import { fileTypeFromBuffer } from 'file-type';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  detectedMimeType?: string;
}

export class FileValidationService {
  private readonly maxFileSizes: Record<string, number> = {
    'image/jpeg': 10 * 1024 * 1024, // 10MB
    'image/png': 10 * 1024 * 1024,  // 10MB
    'image/gif': 5 * 1024 * 1024,   // 5MB
    'image/webp': 10 * 1024 * 1024, // 10MB
    'application/pdf': 25 * 1024 * 1024, // 25MB
    'text/plain': 1 * 1024 * 1024,  // 1MB
    'application/msword': 10 * 1024 * 1024, // 10MB
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 10 * 1024 * 1024, // 10MB
    'application/vnd.ms-excel': 10 * 1024 * 1024, // 10MB
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 10 * 1024 * 1024, // 10MB
  };

  private readonly dangerousExtensions = [
    '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js', '.jar',
    '.app', '.deb', '.pkg', '.dmg', '.rpm', '.msi', '.dll', '.so', '.dylib'
  ];

  private readonly allowedMimeTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'application/pdf', 'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/json', 'application/xml', 'text/xml'
  ];

  // Validate file against security and business rules
  public async validateFile(file: Express.Multer.File, tenantId: string): Promise<ValidationResult> {
    try {
      // Check file size
      const sizeValidation = this.validateFileSize(file);
      if (!sizeValidation.isValid) {
        return sizeValidation;
      }

      // Check file extension
      const extensionValidation = this.validateFileExtension(file.originalname);
      if (!extensionValidation.isValid) {
        return extensionValidation;
      }

      // Validate MIME type against actual file content
      const mimeValidation = await this.validateMimeType(file);
      if (!mimeValidation.isValid) {
        return mimeValidation;
      }

      // Check tenant-specific limits
      const tenantValidation = await this.validateTenantLimits(file, tenantId);
      if (!tenantValidation.isValid) {
        return tenantValidation;
      }

      // Validate file content for malicious patterns
      const contentValidation = await this.validateFileContent(file.buffer, file.mimetype);
      if (!contentValidation.isValid) {
        return contentValidation;
      }

      return { isValid: true };
    } catch (error) {
      logger.error('File validation error', {
        error: error.message,
        filename: file.originalname,
        tenantId,
      });
      return {
        isValid: false,
        error: 'File validation failed due to internal error',
      };
    }
  }

  // Validate file size
  private validateFileSize(file: Express.Multer.File): ValidationResult {
    const maxSize = this.maxFileSizes[file.mimetype] || 5 * 1024 * 1024; // 5MB default
    
    if (file.size > maxSize) {
      return {
        isValid: false,
        error: `File size exceeds maximum allowed size of ${this.formatFileSize(maxSize)}`,
      };
    }

    if (file.size === 0) {
      return {
        isValid: false,
        error: 'File is empty',
      };
    }

    return { isValid: true };
  }

  // Validate file extension
  private validateFileExtension(filename: string): ValidationResult {
    const extension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    
    if (this.dangerousExtensions.includes(extension)) {
      return {
        isValid: false,
        error: `File type ${extension} is not allowed for security reasons`,
      };
    }

    return { isValid: true };
  }

  // Validate MIME type against file content
  private async validateMimeType(file: Express.Multer.File): ValidationResult {
    try {
      // Detect actual file type from content
      const detectedType = await fileTypeFromBuffer(file.buffer);
      const detectedMimeType = detectedType?.mime;

      // Check if declared MIME type is allowed
      if (!this.allowedMimeTypes.includes(file.mimetype)) {
        return {
          isValid: false,
          error: `MIME type ${file.mimetype} is not allowed`,
        };
      }

      // For binary files, ensure declared type matches detected type
      if (detectedMimeType && detectedMimeType !== file.mimetype) {
        // Allow some common mismatches
        const allowedMismatches = this.getAllowedMimeTypeMismatches();
        const mismatchKey = `${file.mimetype}:${detectedMimeType}`;
        
        if (!allowedMismatches.includes(mismatchKey)) {
          return {
            isValid: false,
            error: `File content does not match declared type. Expected: ${file.mimetype}, Detected: ${detectedMimeType}`,
            detectedMimeType,
          };
        }
      }

      return { isValid: true, detectedMimeType };
    } catch (error) {
      logger.warn('MIME type detection failed', {
        error: error.message,
        filename: file.originalname,
      });
      
      // If detection fails, allow text files but be strict with binary files
      if (file.mimetype.startsWith('text/')) {
        return { isValid: true };
      }
      
      return {
        isValid: false,
        error: 'Unable to verify file type',
      };
    }
  }

  // Validate tenant-specific limits
  private async validateTenantLimits(file: Express.Multer.File, tenantId: string): ValidationResult {
    try {
      // Get tenant configuration (placeholder for now)
      const tenantConfig = await this.getTenantFileConfig(tenantId);
      
      // Check if file type is allowed for this tenant
      if (tenantConfig.allowedMimeTypes && !tenantConfig.allowedMimeTypes.includes(file.mimetype)) {
        return {
          isValid: false,
          error: 'File type not allowed for this organization',
        };
      }

      // Check tenant storage quota
      if (tenantConfig.storageQuota) {
        const currentUsage = await this.getTenantStorageUsage(tenantId);
        if (currentUsage + file.size > tenantConfig.storageQuota) {
          return {
            isValid: false,
            error: 'Upload would exceed storage quota',
          };
        }
      }

      return { isValid: true };
    } catch (error) {
      logger.error('Tenant validation error', {
        error: error.message,
        tenantId,
      });
      return { isValid: true }; // Allow upload if validation fails
    }
  }

  // Validate file content for malicious patterns
  private async validateFileContent(buffer: Buffer, mimetype: string): ValidationResult {
    try {
      // Check for embedded executables in images
      if (mimetype.startsWith('image/')) {
        if (this.containsExecutableSignatures(buffer)) {
          return {
            isValid: false,
            error: 'File contains suspicious executable content',
          };
        }
      }

      // Check for script injections in text files
      if (mimetype.startsWith('text/') || mimetype === 'application/json') {
        const content = buffer.toString('utf8');
        if (this.containsMaliciousScript(content)) {
          return {
            isValid: false,
            error: 'File contains potentially malicious script content',
          };
        }
      }

      // Check PDF for embedded JavaScript
      if (mimetype === 'application/pdf') {
        if (this.containsPdfJavaScript(buffer)) {
          return {
            isValid: false,
            error: 'PDF contains embedded JavaScript',
          };
        }
      }

      return { isValid: true };
    } catch (error) {
      logger.warn('Content validation error', {
        error: error.message,
        mimetype,
      });
      return { isValid: true }; // Allow upload if validation fails
    }
  }

  // Scan file for viruses (placeholder for ClamAV integration)
  public async scanForVirus(buffer: Buffer): Promise<void> {
    try {
      // TODO: Integrate with ClamAV or similar antivirus
      // For now, just check for known malicious signatures
      if (this.containsKnownMalwareSignatures(buffer)) {
        throw new Error('File contains known malware signatures');
      }
    } catch (error) {
      logger.error('Virus scan failed', { error: error.message });
      throw new Error('File failed virus scan');
    }
  }

  // Helper methods
  private getAllowedMimeTypeMismatches(): string[] {
    return [
      'text/plain:application/octet-stream',
      'application/json:text/plain',
      'text/csv:text/plain',
    ];
  }

  private async getTenantFileConfig(tenantId: string): Promise<any> {
    // TODO: Implement tenant-specific file configuration
    return {
      allowedMimeTypes: this.allowedMimeTypes,
      storageQuota: 1024 * 1024 * 1024, // 1GB default
    };
  }

  private async getTenantStorageUsage(tenantId: string): Promise<number> {
    const result = await prisma.file.aggregate({
      where: { tenantId },
      _sum: { size: true },
    });
    return result._sum.size || 0;
  }

  private containsExecutableSignatures(buffer: Buffer): boolean {
    const signatures = [
      Buffer.from([0x4D, 0x5A]), // PE executable
      Buffer.from([0x7F, 0x45, 0x4C, 0x46]), // ELF executable
      Buffer.from([0xFE, 0xED, 0xFA, 0xCE]), // Mach-O executable
    ];

    return signatures.some(signature => 
      buffer.indexOf(signature) !== -1
    );
  }

  private containsMaliciousScript(content: string): boolean {
    const maliciousPatterns = [
      /<script[^>]*>.*<\/script>/gi,
      /javascript:/gi,
      /vbscript:/gi,
      /onload\s*=/gi,
      /onerror\s*=/gi,
      /eval\s*\(/gi,
      /document\.write/gi,
    ];

    return maliciousPatterns.some(pattern => pattern.test(content));
  }

  private containsPdfJavaScript(buffer: Buffer): boolean {
    const content = buffer.toString('ascii');
    return /\/JavaScript|\/JS|\/Action/gi.test(content);
  }

  private containsKnownMalwareSignatures(buffer: Buffer): boolean {
    // Simple signature detection - in production, use proper antivirus
    const malwareSignatures = [
      'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*', // EICAR test
    ];

    const content = buffer.toString('ascii');
    return malwareSignatures.some(signature => content.includes(signature));
  }

  private formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
}
