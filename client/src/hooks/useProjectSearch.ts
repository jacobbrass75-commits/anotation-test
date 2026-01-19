import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { GlobalSearchResult, AnnotationCategory, CitationData } from "@shared/schema";

interface SearchFilters {
  categories?: AnnotationCategory[];
  folderIds?: string[];
  documentIds?: string[];
}

interface SearchResponse {
  results: GlobalSearchResult[];
  totalResults: number;
  searchTime: number;
}

interface CitationResponse {
  footnote: string;
  bibliography: string;
}

export function useGlobalSearch() {
  return useMutation({
    mutationFn: async ({ projectId, query, filters, limit }: { 
      projectId: string; 
      query: string; 
      filters?: SearchFilters; 
      limit?: number 
    }): Promise<SearchResponse> => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/search`, { query, filters, limit });
      return res.json();
    },
  });
}

export function useGenerateCitation() {
  return useMutation({
    mutationFn: async ({ citationData, pageNumber, isSubsequent }: { 
      citationData: CitationData; 
      pageNumber?: string; 
      isSubsequent?: boolean 
    }): Promise<CitationResponse> => {
      const res = await apiRequest("POST", "/api/citations/generate", { citationData, pageNumber, isSubsequent });
      return res.json();
    },
  });
}
