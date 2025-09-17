import React, { useState } from 'react';
import { FileText, ExternalLink, Eye, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface Source {
  id: string;
  document_id: string;
  document_title: string;
  document_file_name: string;
  citation_text: string;
  relevance_score: number;
  confidence_level: 'high' | 'medium' | 'low';
}

interface RelatedDocument {
  id: string;
  title: string;
  description?: string;
  file_name: string;
  created_at: string;
}

interface SourceCitationProps {
  sources: Source[];
  relatedDocuments: RelatedDocument[];
  confidenceLevel: 'high' | 'medium' | 'low';
  responseType: 'knowledge_based' | 'general';
}

export const SourceCitation = ({ 
  sources, 
  relatedDocuments, 
  confidenceLevel, 
  responseType 
}: SourceCitationProps) => {
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);

  const getConfidenceColor = (level: string) => {
    switch (level) {
      case 'high': return 'text-green-600 bg-green-50 border-green-200';
      case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'low': return 'text-red-600 bg-red-50 border-red-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getConfidenceIcon = (level: string) => {
    switch (level) {
      case 'high': return '🎯';
      case 'medium': return '⚡';
      case 'low': return '💭';
      default: return '❓';
    }
  };

  if (sources.length === 0 && responseType === 'general') {
    return (
      <div className="mt-3 p-3 bg-muted/30 rounded-lg border border-border/50">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BookOpen className="w-4 h-4" />
          <span className="font-medium">General Knowledge</span>
          <Badge variant="outline" className="text-xs">
            No documents found
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          This response is based on general AI knowledge. Upload relevant documents to get personalized insights.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      {/* Response Type & Confidence Indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-sm">
            <BookOpen className="w-4 h-4 text-chat-primary" />
            <span className="font-medium text-chat-primary">
              {responseType === 'knowledge_based' ? 'Based on your documents' : 'General knowledge'}
            </span>
          </div>
        </div>
        
        <Badge 
          variant="outline" 
          className={`text-xs ${getConfidenceColor(confidenceLevel)}`}
        >
          {getConfidenceIcon(confidenceLevel)} {confidenceLevel} confidence
        </Badge>
      </div>

      {/* Sources */}
      {sources.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Sources ({sources.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {sources.map((source, index) => (
              <Dialog key={source.id}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-auto p-2 text-xs hover:bg-chat-hover transition-colors"
                  >
                    <FileText className="w-3 h-3 mr-1" />
                    <span className="truncate max-w-32">
                      [{index + 1}] {source.document_title}
                    </span>
                    <ExternalLink className="w-3 h-3 ml-1 opacity-60" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[70vh] overflow-hidden">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <FileText className="w-5 h-5" />
                      {source.document_title}
                    </DialogTitle>
                    <DialogDescription>
                      From {source.document_file_name} • Relevance: {Math.round(source.relevance_score * 100)}%
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 overflow-y-auto">
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Eye className="w-4 h-4" />
                          Cited Content
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm">
                        <p className="whitespace-pre-wrap leading-relaxed">
                          {source.citation_text}
                        </p>
                      </CardContent>
                    </Card>
                    
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <span>Confidence:</span>
                        <Badge 
                          variant="outline" 
                          className={getConfidenceColor(source.confidence_level)}
                        >
                          {source.confidence_level}
                        </Badge>
                      </div>
                      <div>
                        Relevance: {Math.round(source.relevance_score * 100)}%
                      </div>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            ))}
          </div>
        </div>
      )}

      {/* Related Documents */}
      {relatedDocuments.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Related Documents
          </div>
          <div className="flex flex-wrap gap-2">
            {relatedDocuments.map((doc) => (
              <Button
                key={doc.id}
                variant="ghost"
                size="sm"
                className="h-auto p-2 text-xs hover:bg-chat-hover/50 transition-colors"
              >
                <FileText className="w-3 h-3 mr-1 opacity-60" />
                <span className="truncate max-w-32">{doc.title}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};