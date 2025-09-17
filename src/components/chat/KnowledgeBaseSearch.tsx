import React, { useState } from 'react';
import { Search, FileText, Calendar, User, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';

interface SearchResult {
  id: string;
  content: string;
  document_id: string;
  document_title: string;
  document_file_name: string;
  document_description?: string;
  similarity: number;
  created_at: string;
}

interface KnowledgeBaseSearchProps {
  onSelectDocument?: (documentId: string) => void;
  className?: string;
}

export const KnowledgeBaseSearch = ({ onSelectDocument, className = '' }: KnowledgeBaseSearchProps) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchType, setSearchType] = useState<'vector' | 'text' | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setIsSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('knowledge-search', {
        body: {
          query: query.trim(),
          limit: 10,
          threshold: 0.6
        }
      });

      if (error) {
        console.error('Search error:', error);
        return;
      }

      setResults(data.results || []);
      setSearchType(data.searchType);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getSimilarityColor = (similarity: number) => {
    if (similarity > 0.8) return 'text-green-600 bg-green-50';
    if (similarity > 0.6) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Search Input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Search your knowledge base..."
            className="pl-10 bg-chat-input-bg border-chat-input-border focus:border-chat-primary"
          />
        </div>
        <Button 
          onClick={handleSearch}
          disabled={!query.trim() || isSearching}
          className="bg-gradient-chat hover:opacity-90"
        >
          {isSearching ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
        </Button>
      </div>

      {/* Search Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-card-foreground">
              Search Results ({results.length})
            </h3>
            {searchType && (
              <Badge variant="outline" className="text-xs">
                {searchType === 'vector' ? 'AI Search' : 'Text Search'}
              </Badge>
            )}
          </div>

          <ScrollArea className="h-96">
            <div className="space-y-3 pr-4">
              {results.map((result) => (
                <Card 
                  key={result.id} 
                  className="cursor-pointer hover:shadow-md transition-shadow border-border/50"
                  onClick={() => onSelectDocument?.(result.document_id)}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <FileText className="w-4 h-4 text-chat-primary" />
                        <span className="truncate">{result.document_title}</span>
                      </CardTitle>
                      <Badge 
                        variant="outline" 
                        className={`text-xs ${getSimilarityColor(result.similarity)}`}
                      >
                        {Math.round(result.similarity * 100)}%
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="truncate">{result.document_file_name}</span>
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formatDate(result.created_at)}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                      {result.content}
                    </p>
                    {result.document_description && (
                      <div className="mt-2 p-2 bg-muted/30 rounded text-xs text-muted-foreground">
                        <strong>Document:</strong> {result.document_description}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Empty State */}
      {results.length === 0 && query && !isSearching && (
        <div className="text-center py-8 text-muted-foreground">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-sm">No results found for "{query}"</p>
          <p className="text-xs mt-1">Try different keywords or upload more documents</p>
        </div>
      )}

      {/* Initial State */}
      {results.length === 0 && !query && (
        <div className="text-center py-8 text-muted-foreground">
          <Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-sm">Search your knowledge base</p>
          <p className="text-xs mt-1">Find relevant information from your uploaded documents</p>
        </div>
      )}
    </div>
  );
};