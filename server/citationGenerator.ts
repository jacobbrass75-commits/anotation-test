import type { CitationData } from "@shared/schema";

function formatAuthors(authors: CitationData['authors'], isFirst: boolean): string {
  if (!authors || authors.length === 0) return "";
  
  if (isFirst) {
    if (authors.length === 1) {
      const a = authors[0];
      const suffix = a.suffix ? ` ${a.suffix}` : "";
      return `${a.firstName} ${a.lastName}${suffix}`;
    }
    if (authors.length === 2) {
      return `${authors[0].firstName} ${authors[0].lastName} and ${authors[1].firstName} ${authors[1].lastName}`;
    }
    if (authors.length === 3) {
      return `${authors[0].firstName} ${authors[0].lastName}, ${authors[1].firstName} ${authors[1].lastName}, and ${authors[2].firstName} ${authors[2].lastName}`;
    }
    return `${authors[0].firstName} ${authors[0].lastName} et al.`;
  } else {
    if (authors.length === 1) {
      return authors[0].lastName;
    }
    if (authors.length <= 3) {
      return authors.map(a => a.lastName).join(", ");
    }
    return `${authors[0].lastName} et al.`;
  }
}

function formatAuthorsForBibliography(authors: CitationData['authors']): string {
  if (!authors || authors.length === 0) return "";
  
  if (authors.length === 1) {
    const a = authors[0];
    const suffix = a.suffix ? ` ${a.suffix}` : "";
    return `${a.lastName}, ${a.firstName}${suffix}`;
  }
  
  const first = authors[0];
  const suffix = first.suffix ? ` ${first.suffix}` : "";
  let result = `${first.lastName}, ${first.firstName}${suffix}`;
  
  for (let i = 1; i < authors.length; i++) {
    const a = authors[i];
    const aSuffix = a.suffix ? ` ${a.suffix}` : "";
    if (i === authors.length - 1) {
      result += `, and ${a.firstName} ${a.lastName}${aSuffix}`;
    } else {
      result += `, ${a.firstName} ${a.lastName}${aSuffix}`;
    }
  }
  
  return result;
}

function getShortTitle(title: string): string {
  const words = title.split(' ');
  if (words.length <= 4) return title;
  return words.slice(0, 4).join(' ');
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split('-');
  if (parts.length === 1) return parts[0];
  
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  
  const year = parts[0];
  const month = months[parseInt(parts[1], 10) - 1] || '';
  const day = parts[2] ? parseInt(parts[2], 10) : null;
  
  if (day && month) {
    return `${month} ${day}, ${year}`;
  }
  if (month) {
    return `${month} ${year}`;
  }
  return year;
}

function getYear(dateStr?: string): string {
  if (!dateStr) return "";
  return dateStr.split('-')[0];
}

export function generateChicagoFootnote(
  citation: CitationData,
  pageNumber?: string,
  isSubsequent?: boolean
): string {
  const pageRef = pageNumber ? `, ${pageNumber}` : "";
  
  if (isSubsequent) {
    const author = formatAuthors(citation.authors, false);
    const shortTitle = getShortTitle(citation.title);
    
    if (citation.sourceType === 'journal' || citation.sourceType === 'chapter' || citation.sourceType === 'newspaper') {
      return `${author}, "${shortTitle}"${pageRef}.`;
    }
    return `${author}, ${shortTitle}${pageRef}.`;
  }
  
  const author = formatAuthors(citation.authors, true);
  
  switch (citation.sourceType) {
    case 'book': {
      const title = citation.subtitle ? `${citation.title}: ${citation.subtitle}` : citation.title;
      const edition = citation.edition ? `, ${citation.edition} ed.` : "";
      const place = citation.publicationPlace || "";
      const publisher = citation.publisher || "";
      const year = getYear(citation.publicationDate);
      const pubInfo = place && publisher ? `(${place}: ${publisher}, ${year})` : `(${year})`;
      return `${author}, ${title}${edition} ${pubInfo}${pageRef}.`;
    }
    
    case 'journal': {
      const title = `"${citation.title}"`;
      const journal = citation.containerTitle || "";
      const vol = citation.volume || "";
      const issue = citation.issue ? `, no. ${citation.issue}` : "";
      const year = getYear(citation.publicationDate);
      return `${author}, ${title} ${journal} ${vol}${issue} (${year})${pageRef.replace(',', ':')}.`;
    }
    
    case 'chapter': {
      const chapterTitle = `"${citation.title}"`;
      const bookTitle = citation.containerTitle || "";
      const editors = citation.editors && citation.editors.length > 0
        ? `, edited by ${citation.editors.map(e => `${e.firstName} ${e.lastName}`).join(" and ")}`
        : "";
      const place = citation.publicationPlace || "";
      const publisher = citation.publisher || "";
      const year = getYear(citation.publicationDate);
      const pubInfo = place && publisher ? `(${place}: ${publisher}, ${year})` : `(${year})`;
      return `${author}, ${chapterTitle} in ${bookTitle}${editors} ${pubInfo}${pageRef}.`;
    }
    
    case 'website': {
      const title = `"${citation.title}"`;
      const site = citation.containerTitle || "";
      const accessed = citation.accessDate ? `accessed ${formatDate(citation.accessDate)}` : "";
      const url = citation.url || "";
      return `${title}${site ? `, ${site}` : ""}, ${accessed}, ${url}.`;
    }
    
    case 'newspaper': {
      const title = `"${citation.title}"`;
      const paper = citation.containerTitle || "";
      const date = formatDate(citation.publicationDate);
      const url = citation.url ? `, ${citation.url}` : "";
      return `${author}, ${title} ${paper}, ${date}${url}.`;
    }
    
    case 'thesis': {
      const title = `"${citation.title}"`;
      const type = "PhD diss.";
      const institution = citation.publisher || "";
      const year = getYear(citation.publicationDate);
      return `${author}, ${title} (${type}, ${institution}, ${year})${pageRef}.`;
    }
    
    default: {
      const title = citation.containerTitle ? `"${citation.title}"` : citation.title;
      const container = citation.containerTitle ? `, ${citation.containerTitle}` : "";
      const year = getYear(citation.publicationDate);
      return `${author}, ${title}${container} (${year})${pageRef}.`;
    }
  }
}

/**
 * Generate a Chicago-style footnote with an embedded quote
 * Format: Author, Title (Publication Info), page, "quoted text."
 */
export function generateFootnoteWithQuote(
  citation: CitationData,
  quote: string,
  pageNumber?: string
): string {
  // Get the base footnote without the trailing period
  const baseFootnote = generateChicagoFootnote(citation, pageNumber, false);
  const footnoteWithoutPeriod = baseFootnote.slice(0, -1);

  // Clean up the quote - remove excessive whitespace, ensure proper formatting
  const cleanQuote = quote.trim().replace(/\s+/g, ' ');

  // Truncate very long quotes for footnote readability (keep first ~150 chars)
  const displayQuote = cleanQuote.length > 150
    ? cleanQuote.substring(0, 147) + '...'
    : cleanQuote;

  // Format: Footnote info, "quoted text."
  return `${footnoteWithoutPeriod}: "${displayQuote}."`;
}

/**
 * Generate a short citation for inline use
 * Format: (Author, "Short Title," page)
 */
export function generateInlineCitation(
  citation: CitationData,
  pageNumber?: string
): string {
  const author = citation.authors && citation.authors.length > 0
    ? citation.authors[0].lastName
    : "Unknown";
  const shortTitle = getShortTitle(citation.title);
  const page = pageNumber ? `, ${pageNumber}` : "";

  if (citation.sourceType === 'journal' || citation.sourceType === 'chapter' || citation.sourceType === 'newspaper') {
    return `(${author}, "${shortTitle}"${page})`;
  }
  return `(${author}, ${shortTitle}${page})`;
}

export function generateChicagoBibliography(citation: CitationData): string {
  const author = formatAuthorsForBibliography(citation.authors);
  
  switch (citation.sourceType) {
    case 'book': {
      const title = citation.subtitle ? `${citation.title}: ${citation.subtitle}` : citation.title;
      const edition = citation.edition ? ` ${citation.edition} ed.` : "";
      const place = citation.publicationPlace || "";
      const publisher = citation.publisher || "";
      const year = getYear(citation.publicationDate);
      const pubInfo = place && publisher ? `${place}: ${publisher}, ${year}` : year;
      return `${author}. ${title}.${edition} ${pubInfo}.`;
    }
    
    case 'journal': {
      const title = `"${citation.title}."`;
      const journal = citation.containerTitle || "";
      const vol = citation.volume || "";
      const issue = citation.issue ? `, no. ${citation.issue}` : "";
      const year = getYear(citation.publicationDate);
      const pages = citation.pageStart && citation.pageEnd 
        ? `: ${citation.pageStart}-${citation.pageEnd}` 
        : citation.pageStart ? `: ${citation.pageStart}` : "";
      const doi = citation.doi ? ` https://doi.org/${citation.doi}.` : "";
      return `${author}. ${title} ${journal} ${vol}${issue} (${year})${pages}.${doi}`;
    }
    
    case 'chapter': {
      const chapterTitle = `"${citation.title}."`;
      const bookTitle = citation.containerTitle || "";
      const editors = citation.editors && citation.editors.length > 0
        ? `Edited by ${citation.editors.map(e => `${e.firstName} ${e.lastName}`).join(" and ")}. `
        : "";
      const pages = citation.pageStart && citation.pageEnd 
        ? `${citation.pageStart}-${citation.pageEnd}. ` 
        : "";
      const place = citation.publicationPlace || "";
      const publisher = citation.publisher || "";
      const year = getYear(citation.publicationDate);
      const pubInfo = place && publisher ? `${place}: ${publisher}, ${year}` : year;
      return `${author}. ${chapterTitle} In ${bookTitle}. ${editors}${pages}${pubInfo}.`;
    }
    
    case 'website': {
      const title = `"${citation.title}."`;
      const site = citation.containerTitle || "";
      const accessed = citation.accessDate ? `Accessed ${formatDate(citation.accessDate)}. ` : "";
      const url = citation.url || "";
      return `${site}. ${title} ${accessed}${url}.`;
    }
    
    case 'newspaper': {
      const title = `"${citation.title}."`;
      const paper = citation.containerTitle || "";
      const date = formatDate(citation.publicationDate);
      const url = citation.url ? ` ${citation.url}` : "";
      return `${author}. ${title} ${paper}, ${date}.${url}`;
    }
    
    case 'thesis': {
      const title = `"${citation.title}."`;
      const institution = citation.publisher || "";
      const year = getYear(citation.publicationDate);
      return `${author}. ${title} PhD diss., ${institution}, ${year}.`;
    }
    
    default: {
      const title = citation.containerTitle ? `"${citation.title}."` : `${citation.title}.`;
      const container = citation.containerTitle ? ` ${citation.containerTitle}.` : "";
      const year = getYear(citation.publicationDate);
      return `${author}. ${title}${container} ${year}.`;
    }
  }
}
