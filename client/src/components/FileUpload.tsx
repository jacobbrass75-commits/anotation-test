import { useState, useCallback } from "react";
import { Upload, FileText, X, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface FileUploadProps {
  onUpload: (file: File) => Promise<void>;
  isUploading: boolean;
  uploadProgress: number;
}

export function FileUpload({ onUpload, isUploading, uploadProgress }: FileUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (isValidFile(file)) {
        setSelectedFile(file);
      }
    }
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (isValidFile(file)) {
        setSelectedFile(file);
      }
    }
  }, []);

  const isValidFile = (file: File) => {
    const validTypes = ["application/pdf", "text/plain"];
    return validTypes.includes(file.type) || file.name.endsWith(".txt") || file.name.endsWith(".pdf");
  };

  const handleUpload = async () => {
    if (selectedFile) {
      await onUpload(selectedFile);
      setSelectedFile(null);
    }
  };

  const clearSelection = () => {
    setSelectedFile(null);
  };

  if (isUploading) {
    return (
      <Card className="p-8">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 text-primary animate-spin" />
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">Processing document...</p>
            <p className="text-xs text-muted-foreground mt-1">Extracting text and preparing for analysis</p>
          </div>
          <div className="w-full max-w-xs">
            <Progress value={uploadProgress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center mt-2">{uploadProgress}% complete</p>
          </div>
        </div>
      </Card>
    );
  }

  if (selectedFile) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-primary/10 rounded-lg">
            <FileText className="h-8 w-8 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{selectedFile.name}</p>
            <p className="text-xs text-muted-foreground">
              {(selectedFile.size / 1024).toFixed(1)} KB
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={clearSelection}
              data-testid="button-clear-file"
              aria-label="Remove file"
            >
              <X className="h-4 w-4" />
            </Button>
            <Button onClick={handleUpload} data-testid="button-upload-file">
              Upload
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      className={`p-8 border-2 border-dashed transition-colors duration-200 ${
        dragActive ? "border-primary bg-primary/5" : "border-muted hover:border-muted-foreground/30"
      }`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <label className="cursor-pointer">
        <input
          type="file"
          className="hidden"
          accept=".pdf,.txt,application/pdf,text/plain"
          onChange={handleChange}
          data-testid="input-file-upload"
        />
        <div className="flex flex-col items-center gap-4">
          <div className="p-4 bg-muted rounded-full">
            <Upload className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">
              Drop PDF or TXT file, or click to browse
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Maximum file size: 10MB
            </p>
          </div>
          <div className="flex gap-2">
            <Badge variant="secondary">PDF</Badge>
            <Badge variant="secondary">TXT</Badge>
          </div>
        </div>
      </label>
    </Card>
  );
}
