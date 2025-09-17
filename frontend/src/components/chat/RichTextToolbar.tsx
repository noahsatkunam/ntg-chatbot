import React from 'react';
import { 
  Bold, 
  Italic, 
  Underline, 
  Code, 
  Link, 
  List, 
  ListOrdered,
  Quote
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

interface RichTextToolbarProps {
  onFormatText: (format: string) => void;
  className?: string;
}

export const RichTextToolbar = ({ onFormatText, className = '' }: RichTextToolbarProps) => {
  const toolbarItems = [
    { icon: Bold, format: 'bold', label: 'Bold (Ctrl+B)' },
    { icon: Italic, format: 'italic', label: 'Italic (Ctrl+I)' },
    { icon: Underline, format: 'underline', label: 'Underline (Ctrl+U)' },
    { icon: Code, format: 'code', label: 'Code (Ctrl+`)' },
  ];

  const listItems = [
    { icon: List, format: 'bullet-list', label: 'Bullet List' },
    { icon: ListOrdered, format: 'ordered-list', label: 'Numbered List' },
  ];

  const formatItems = [
    { icon: Quote, format: 'blockquote', label: 'Quote' },
    { icon: Link, format: 'link', label: 'Link' },
  ];

  return (
    <div className={`flex items-center gap-1 p-2 bg-card border border-border rounded-lg ${className}`}>
      {/* Text formatting */}
      {toolbarItems.map((item) => (
        <Button
          key={item.format}
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 hover:bg-chat-hover"
          onClick={() => onFormatText(item.format)}
          title={item.label}
        >
          <item.icon className="w-4 h-4" />
        </Button>
      ))}

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* Lists */}
      {listItems.map((item) => (
        <Button
          key={item.format}
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 hover:bg-chat-hover"
          onClick={() => onFormatText(item.format)}
          title={item.label}
        >
          <item.icon className="w-4 h-4" />
        </Button>
      ))}

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* Other formatting */}
      {formatItems.map((item) => (
        <Button
          key={item.format}
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 hover:bg-chat-hover"
          onClick={() => onFormatText(item.format)}
          title={item.label}
        >
          <item.icon className="w-4 h-4" />
        </Button>
      ))}
    </div>
  );
};
