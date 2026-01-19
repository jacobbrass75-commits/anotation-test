import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import { storage } from "./storage";
import { extractTextFromTxt } from "./chunker";
import {
  getEmbedding,
  analyzeChunkForIntent,
  generateDocumentSummary,
  searchDocument,
  findHighlightPosition,
  cosineSimilarity,
  PIPELINE_CONFIG,
  getMaxChunksForLevel,
  type ThoroughnessLevel,
} from "./openai";
// V2 Pipeline - improved annotation system
import {
  processChunksWithPipelineV2,
  chunkTextV2,
  clearDocumentContextCacheV2,
  PIPELINE_V2_CONFIG,
} from "./pipelineV2";
import { registerProjectRoutes } from "./projectRoutes";
import type { AnnotationCategory, InsertAnnotation } from "@shared/schema";

// Detect garbled text from failed PDF extraction
// Checks for high ratio of non-word characters or unusual patterns
function isGarbledText(text: string): boolean {
  if (!text || text.length < 100) return false;
  
  // Sample the first 2000 characters for analysis
  const sample = text.slice(0, 2000);
  
  // Count normal words (sequences of 3+ alphabetic characters)
  const words = sample.match(/[a-zA-Z]{3,}/g) || [];
  
  // Count special/unusual character patterns
  const specialChars = sample.match(/[^\w\s.,;:!?'"()-]/g) || [];
  const brackets = sample.match(/[\[\]{}\\|^~`@#$%&*+=<>]/g) || [];
  
  // Calculate ratios
  const wordChars = words.join("").length;
  const totalChars = sample.replace(/\s/g, "").length;
  const wordRatio = totalChars > 0 ? wordChars / totalChars : 0;
  const bracketRatio = totalChars > 0 ? brackets.length / totalChars : 0;
  
  // Text is likely garbled if:
  // - Less than 40% of non-space characters form recognizable words
  // - Or more than 10% are unusual bracket/symbol characters
  // - Or average "word" length is very short (fragmented characters)
  const avgWordLen = words.length > 0 ? wordChars / words.length : 0;
  
  return wordRatio < 0.4 || bracketRatio > 0.1 || (words.length > 10 && avgWordLen < 3);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["application/pdf", "text/plain"];
    const allowedExtensions = [".pdf", ".txt"];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf("."));
    
    if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and TXT files are allowed"));
    }
  },
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Upload document
  app.post("/api/upload", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const file = req.file;
      let fullText: string;

      // Extract text based on file type
      if (file.mimetype === "application/pdf" || file.originalname.endsWith(".pdf")) {
        // Use pdf-parse to properly extract text from PDF
        const parser = new PDFParse({ data: file.buffer });
        const textResult = await parser.getText();
        fullText = textResult.text;
        await parser.destroy();
        // Clean up whitespace
        fullText = fullText.replace(/\s+/g, " ").trim();
        
        // Check if extracted text appears garbled (common with scanned PDFs or custom fonts)
        if (isGarbledText(fullText)) {
          return res.status(400).json({ 
            message: "This PDF appears to be scanned or uses custom fonts that cannot be read. Please try: (1) Using a PDF with selectable text, or (2) Copy the text content into a .txt file and upload that instead." 
          });
        }
      } else {
        fullText = extractTextFromTxt(file.buffer.toString("utf-8"));
      }

      if (!fullText || fullText.length < 10) {
        return res.status(400).json({ message: "Could not extract text from file" });
      }

      // Create document
      const doc = await storage.createDocument({
        filename: file.originalname,
        fullText,
      });

      // Chunk the text using V2 chunking (with noise filtering and larger chunks)
      const chunks = chunkTextV2(fullText);

      // Store chunks (don't generate embeddings yet - do it during analysis)
      for (const chunk of chunks) {
        await storage.createChunk({
          documentId: doc.id,
          text: chunk.text,
          startPosition: chunk.originalStartPosition,
          endPosition: chunk.originalStartPosition + chunk.text.length,
        });
      }

      // Update document with chunk count
      await storage.updateDocument(doc.id, { chunkCount: chunks.length });

      // Generate summary in background
      generateDocumentSummary(fullText).then(async (summaryData) => {
        await storage.updateDocument(doc.id, {
          summary: summaryData.summary,
          mainArguments: summaryData.mainArguments,
          keyConcepts: summaryData.keyConcepts,
        });
      });

      const updatedDoc = await storage.getDocument(doc.id);
      res.json(updatedDoc);
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ message: error instanceof Error ? error.message : "Upload failed" });
    }
  });

  // Get all documents
  app.get("/api/documents", async (req: Request, res: Response) => {
    try {
      const docs = await storage.getAllDocuments();
      res.json(docs);
    } catch (error) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ message: "Failed to fetch documents" });
    }
  });

  // Get single document
  app.get("/api/documents/:id", async (req: Request, res: Response) => {
    try {
      const doc = await storage.getDocument(req.params.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }
      res.json(doc);
    } catch (error) {
      console.error("Error fetching document:", error);
      res.status(500).json({ message: "Failed to fetch document" });
    }
  });

  // Set intent and trigger AI analysis
  app.post("/api/documents/:id/set-intent", async (req: Request, res: Response) => {
    try {
      const { intent, thoroughness = 'standard' } = req.body;
      if (!intent || typeof intent !== "string") {
        return res.status(400).json({ message: "Intent is required" });
      }

      // Validate thoroughness level
      const validLevels: ThoroughnessLevel[] = ['quick', 'standard', 'thorough', 'exhaustive'];
      const level: ThoroughnessLevel = validLevels.includes(thoroughness) ? thoroughness : 'standard';

      const doc = await storage.getDocument(req.params.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }

      // Update document with intent
      await storage.updateDocument(doc.id, { userIntent: intent });

      // Get chunks
      const chunks = await storage.getChunksForDocument(doc.id);
      if (chunks.length === 0) {
        return res.status(400).json({ message: "No text chunks found for analysis" });
      }

      // Generate intent embedding
      const intentEmbedding = await getEmbedding(intent);

      // Generate embeddings for chunks if not already done
      const chunksWithEmbeddings = await Promise.all(
        chunks.map(async (chunk) => {
          if (!chunk.embedding) {
            const embedding = await getEmbedding(chunk.text);
            await storage.updateChunkEmbedding(chunk.id, embedding);
            return { ...chunk, embedding };
          }
          return chunk;
        })
      );

      // Calculate similarity and rank chunks
      const rankedChunks = chunksWithEmbeddings
        .map((chunk) => ({
          chunk,
          similarity: cosineSimilarity(chunk.embedding!, intentEmbedding),
        }))
        .sort((a, b) => b.similarity - a.similarity);

      // Filter to top relevant chunks based on thoroughness level
      const maxChunks = getMaxChunksForLevel(level);
      const minSimilarity = level === 'exhaustive' ? 0.1 : 0.3;

      const topChunks = rankedChunks
        .filter(({ similarity }) => similarity >= minSimilarity)
        .slice(0, maxChunks)
        .map(({ chunk }) => ({
          text: chunk.text,
          startPosition: chunk.startPosition,
          id: chunk.id,
        }));

      if (topChunks.length === 0) {
        return res.json([]);
      }

      // Get existing non-AI annotations to avoid duplicates
      const existingAnnotations = await storage.getAnnotationsForDocument(doc.id);
      const userAnnotations = existingAnnotations
        .filter((a) => !a.isAiGenerated)
        .map((a) => ({
          startPosition: a.startPosition,
          endPosition: a.endPosition,
          confidenceScore: a.confidenceScore,
        }));

      // Delete existing AI annotations before generating new ones
      for (const ann of existingAnnotations.filter(a => a.isAiGenerated)) {
        await storage.deleteAnnotation(ann.id);
      }

      // Process chunks through the V2 three-phase pipeline (improved)
      const pipelineAnnotations = await processChunksWithPipelineV2(
        topChunks,
        intent,
        doc.id,
        doc.fullText,
        userAnnotations
      );

      // Clear document context cache
      clearDocumentContextCacheV2(doc.id);

      // Create new annotations from pipeline results
      for (const ann of pipelineAnnotations) {
        await storage.createAnnotation({
          documentId: doc.id,
          startPosition: ann.absoluteStart,
          endPosition: ann.absoluteEnd,
          highlightedText: ann.highlightText,
          category: ann.category,
          note: ann.note,
          isAiGenerated: true,
          confidenceScore: ann.confidence,
        });
      }

      const finalAnnotations = await storage.getAnnotationsForDocument(doc.id);
      res.json(finalAnnotations);
    } catch (error) {
      console.error("Analysis error:", error);
      res.status(500).json({ message: error instanceof Error ? error.message : "Analysis failed" });
    }
  });

  // Get annotations for document
  app.get("/api/documents/:id/annotations", async (req: Request, res: Response) => {
    try {
      const annotations = await storage.getAnnotationsForDocument(req.params.id);
      res.json(annotations);
    } catch (error) {
      console.error("Error fetching annotations:", error);
      res.status(500).json({ message: "Failed to fetch annotations" });
    }
  });

  // Add manual annotation
  app.post("/api/documents/:id/annotate", async (req: Request, res: Response) => {
    try {
      const { startPosition, endPosition, highlightedText, category, note, isAiGenerated } = req.body;

      if (
        typeof startPosition !== "number" ||
        typeof endPosition !== "number" ||
        !highlightedText ||
        !category ||
        !note
      ) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const doc = await storage.getDocument(req.params.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }

      const annotation = await storage.createAnnotation({
        documentId: doc.id,
        startPosition,
        endPosition,
        highlightedText,
        category: category as AnnotationCategory,
        note,
        isAiGenerated: isAiGenerated || false,
      });

      res.json(annotation);
    } catch (error) {
      console.error("Error creating annotation:", error);
      res.status(500).json({ message: "Failed to create annotation" });
    }
  });

  // Update annotation
  app.put("/api/annotations/:id", async (req: Request, res: Response) => {
    try {
      const { note, category } = req.body;

      if (!note || !category) {
        return res.status(400).json({ message: "Note and category are required" });
      }

      const annotation = await storage.updateAnnotation(
        req.params.id,
        note,
        category as AnnotationCategory
      );

      if (!annotation) {
        return res.status(404).json({ message: "Annotation not found" });
      }

      res.json(annotation);
    } catch (error) {
      console.error("Error updating annotation:", error);
      res.status(500).json({ message: "Failed to update annotation" });
    }
  });

  // Delete annotation
  app.delete("/api/annotations/:id", async (req: Request, res: Response) => {
    try {
      await storage.deleteAnnotation(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting annotation:", error);
      res.status(500).json({ message: "Failed to delete annotation" });
    }
  });

  // Search document
  app.post("/api/documents/:id/search", async (req: Request, res: Response) => {
    try {
      const { query } = req.body;

      if (!query || typeof query !== "string") {
        return res.status(400).json({ message: "Query is required" });
      }

      const doc = await storage.getDocument(req.params.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }

      // Get chunks with embeddings
      const chunks = await storage.getChunksForDocument(doc.id);
      
      // Generate query embedding
      const queryEmbedding = await getEmbedding(query);

      // Rank chunks by similarity
      const rankedChunks = chunks
        .filter((c) => c.embedding)
        .map((chunk) => ({
          text: chunk.text,
          startPosition: chunk.startPosition,
          endPosition: chunk.endPosition,
          similarity: cosineSimilarity(chunk.embedding!, queryEmbedding),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5);

      if (rankedChunks.length === 0) {
        return res.json([]);
      }

      // Use LLM to find relevant quotes
      const results = await searchDocument(
        query,
        doc.userIntent || "",
        rankedChunks
      );

      res.json(results);
    } catch (error) {
      console.error("Search error:", error);
      res.status(500).json({ message: error instanceof Error ? error.message : "Search failed" });
    }
  });

  // Get document summary
  app.get("/api/documents/:id/summary", async (req: Request, res: Response) => {
    try {
      const doc = await storage.getDocument(req.params.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }

      res.json({
        summary: doc.summary,
        mainArguments: doc.mainArguments,
        keyConcepts: doc.keyConcepts,
      });
    } catch (error) {
      console.error("Error fetching summary:", error);
      res.status(500).json({ message: "Failed to fetch summary" });
    }
  });

  // Register project routes
  registerProjectRoutes(app);

  // Register A/B test routes
  // registerABTestRoutes(app); // TODO: Not implemented yet

  return httpServer;
}
