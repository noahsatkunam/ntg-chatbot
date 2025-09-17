import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, File, Image, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Attachment } from './types';

interface FileUploadZoneProps {
  attachments: Attachment[];
  onAttachmentsChange: (attachments: Attachment[]) => void;
  maxFiles?: number;
  maxSize?: number; // in bytes
}

export const FileUploadZone = ({ 
  attachments, 
  onAttachmentsChange, 
  maxFiles = 10, 
  maxSize = 20 * 1024 * 1024 // 20MB
}: FileUploadZoneProps) => {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newAttachments: Attachment[] = acceptedFiles.map(file => ({
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      name: file.name,
      type: file.type,
      size: file.size,
      url: URL.createObjectURL(file),
    }));

    onAttachmentsChange([...attachments, ...newAttachments].slice(0, maxFiles));
  }, [attachments, onAttachmentsChange, maxFiles]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: maxFiles - attachments.length,
    maxSize,
    multiple: true,
  });

  const removeAttachment = (id: string) => {
    const attachment = attachments.find(a => a.id === id);
    if (attachment) {
      URL.revokeObjectURL(attachment.url);
    }
    onAttachmentsChange(attachments.filter(a => a.id !== id));
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return Image;
    if (type.includes('text') || type.includes('document')) return FileText;
    return File;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-3">
      {/* File Upload Zone */}
      {attachments.length < maxFiles && (
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
            isDragActive
              ? 'border-chat-primary bg-chat-primary/10'
              : 'border-border hover:border-chat-primary/50 hover:bg-chat-hover/50'
          }`}
        >
          <input {...getInputProps()} />
          <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
          {isDragActive ? (
            <p className="text-sm text-chat-primary">Drop files here...</p>
          ) : (
            <div>
              <p className="text-sm text-foreground mb-1">
                Drag & drop files here, or click to select
              </p>
              <p className="text-xs text-muted-foreground">
                Max {maxFiles} files, {formatFileSize(maxSize)} each
              </p>
            </div>
          )}
        </div>
      )}

      {/* Attached Files List */}
      {attachments.length > 0 && (
        <div className="space-y-2">
          {attachments.map((attachment) => {
            const IconComponent = getFileIcon(attachment.type);
            return (
              <div
                key={attachment.id}
                className="flex items-center gap-3 p-2 bg-chat-secondary/30 rounded-lg border border-border/50"
              >
                <IconComponent className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{attachment.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(attachment.size)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 hover:bg-destructive/20 hover:text-destructive"
                  onClick={() => removeAttachment(attachment.id)}
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};