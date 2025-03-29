import { type InventoryItem, type DocumentType, type Category, type ReportType } from "@shared/schema";
import { formatCurrency } from "./utils";

// Interface for document generator options
interface DocumentGeneratorOptions {
  title: string;
  reportType: ReportType;
  items: InventoryItem[];
  categories?: Category[];
}

// Main document generator function
export async function generateDocument(
  format: DocumentType,
  options: DocumentGeneratorOptions
): Promise<void> {
  switch (format) {
    case "pdf":
      await generatePdfDocument(options);
      break;
    case "csv":
      await generateCsvDocument(options);
      break;
    case "excel":
      await generateExcelDocument(options);
      break;
    default:
      throw new Error(`Unsupported document format: ${format}`);
  }
}

// PDF document generator
async function generatePdfDocument(options: DocumentGeneratorOptions): Promise<void> {
  try {
    const response = await fetch(`/api/export/${options.reportType}/pdf`);
    
    if (!response.ok) {
      throw new Error(`Failed to generate PDF: ${response.statusText}`);
    }
    
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    
    // Create a download link and trigger the download
    const a = document.createElement("a");
    a.href = url;
    a.download = `${options.title.replace(/\s+/g, "-").toLowerCase()}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // Clean up the object URL
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error generating PDF document:", error);
    throw error;
  }
}

// CSV document generator
async function generateCsvDocument(options: DocumentGeneratorOptions): Promise<void> {
  try {
    const response = await fetch(`/api/export/${options.reportType}/csv`);
    
    if (!response.ok) {
      throw new Error(`Failed to generate CSV: ${response.statusText}`);
    }
    
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    
    // Create a download link and trigger the download
    const a = document.createElement("a");
    a.href = url;
    a.download = `${options.title.replace(/\s+/g, "-").toLowerCase()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // Clean up the object URL
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error generating CSV document:", error);
    throw error;
  }
}

// Excel document generator
async function generateExcelDocument(options: DocumentGeneratorOptions): Promise<void> {
  try {
    const response = await fetch(`/api/export/${options.reportType}/excel`);
    
    if (!response.ok) {
      throw new Error(`Failed to generate Excel file: ${response.statusText}`);
    }
    
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    
    // Create a download link and trigger the download
    const a = document.createElement("a");
    a.href = url;
    a.download = `${options.title.replace(/\s+/g, "-").toLowerCase()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // Clean up the object URL
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error generating Excel document:", error);
    throw error;
  }
}

// Helper function to format inventory data for reports
export function formatInventoryDataForReport(
  items: InventoryItem[],
  categories?: Category[]
): Record<string, string | number>[] {
  return items.map(item => {
    const categoryName = item.categoryId && categories 
      ? categories.find(c => c.id === item.categoryId)?.name || "Uncategorized"
      : "Uncategorized";
    
    const value = item.price * item.quantity;
    
    return {
      Name: item.name,
      SKU: item.sku,
      Category: categoryName,
      Quantity: item.quantity,
      Price: formatCurrency(item.price),
      Value: formatCurrency(value),
      Location: item.location || "N/A",
      LowStockThreshold: item.lowStockThreshold
    };
  });
}

// Helper function to categorize inventory by category
export function categorizeInventoryByCategory(
  items: InventoryItem[],
  categories?: Category[]
): Record<string, InventoryItem[]> {
  const categorized: Record<string, InventoryItem[]> = {};
  
  if (!categories || categories.length === 0) {
    categorized["Uncategorized"] = [...items];
    return categorized;
  }
  
  // Initialize with empty arrays for all categories
  categories.forEach(category => {
    categorized[category.name] = [];
  });
  
  // Add "Uncategorized" category
  categorized["Uncategorized"] = [];
  
  // Categorize items
  items.forEach(item => {
    if (item.categoryId && categories) {
      const category = categories.find(c => c.id === item.categoryId);
      if (category) {
        categorized[category.name].push(item);
      } else {
        categorized["Uncategorized"].push(item);
      }
    } else {
      categorized["Uncategorized"].push(item);
    }
  });
  
  return categorized;
}
