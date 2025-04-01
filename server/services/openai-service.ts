/**
 * OpenAI Service
 * 
 * This service handles integration with the OpenAI API for AI-powered
 * features such as image recognition and text analysis.
 */

import { RecognizedItem } from './image-recognition-service';
import { storage } from '../storage';
import * as fs from 'fs';
import fetch from 'node-fetch';

// Check if OpenAI API key is configured
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const isConfigured = !!OPENAI_API_KEY;

// Configuration for the OpenAI API
const OPENAI_API_URL = 'https://api.openai.com/v1';
const GPT_MODEL = 'gpt-4-vision-preview';
const MAX_TOKENS = 500;

// Get the OpenAI API status
export function getOpenAIStatus() {
  return {
    configured: isConfigured,
    provider: 'OpenAI',
    mode: isConfigured ? 'AI Recognition' : 'Simulation Mode'
  };
}

/**
 * Analyze product image using OpenAI's Vision API
 * @param imageBuffer - The image data to analyze
 * @returns RecognizedItem with product information
 */
export async function analyzeProductImage(imageBuffer: Buffer): Promise<RecognizedItem> {
  if (!isConfigured) {
    throw new Error('OpenAI API is not configured. Set the OPENAI_API_KEY environment variable.');
  }

  try {
    // Convert image buffer to base64
    const base64Image = imageBuffer.toString('base64');
    
    // Create prompt for the OpenAI API
    const prompt = `
      You are an expert inventory management assistant. Analyze this product image and extract the following information:
      1. Product name
      2. A detailed description of the product
      3. Category
      4. Possible SKU or barcode visible in the image
      5. Color, size, dimensions if visible
      6. Brand or manufacturer if identifiable
      7. Approximate recommended retail price range
      8. Material or composition
      9. Any other notable attributes
      
      Format your response as a valid JSON object with these keys: name, description, category, sku, color, dimensions, brand, manufacturer, price, attributes (as an object with additional properties).
      Do not include any markdown or text outside of the JSON object.
    `;

    // Make request to OpenAI API
    const response = await fetch(`${OPENAI_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: GPT_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: MAX_TOKENS
      })
    });

    // Parse response
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;
    
    if (!data.choices || data.choices.length === 0) {
      throw new Error('OpenAI API returned an empty response');
    }

    // Extract JSON content from response
    const content = data.choices[0].message.content;
    
    // Parse JSON (handling various formats that might be returned)
    let parsedContent: any;
    try {
      // Try to parse directly if it's a clean JSON
      parsedContent = JSON.parse(content);
    } catch (e) {
      // If direct parsing fails, try to extract JSON from markdown or text
      const jsonMatch = content.match(/```json\n([\s\S]*?)```/) || 
                         content.match(/```([\s\S]*?)```/) ||
                         content.match(/{[\s\S]*?}/);
      
      if (jsonMatch) {
        try {
          parsedContent = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        } catch (e2) {
          throw new Error(`Failed to parse OpenAI response as JSON: ${e2.message}`);
        }
      } else {
        throw new Error('Could not extract JSON from OpenAI response');
      }
    }

    // Create recognized item with AI analysis
    const recognizedItem: RecognizedItem = {
      name: parsedContent.name || 'Unknown Product',
      sku: parsedContent.sku || generateRandomSku(),
      description: parsedContent.description || '',
      category: parsedContent.category || '',
      price: parsePrice(parsedContent.price),
      quantity: 1, // Default quantity
      dimensions: {
        length: parsedContent.dimensions?.length,
        width: parsedContent.dimensions?.width,
        height: parsedContent.dimensions?.height,
        unit: parsedContent.dimensions?.unit || 'cm'
      },
      weight: {
        value: parsedContent.weight?.value,
        unit: parsedContent.weight?.unit || 'kg'
      },
      color: parsedContent.color || '',
      brand: parsedContent.brand || '',
      manufacturer: parsedContent.manufacturer || '',
      model: parsedContent.model || '',
      attributes: parsedContent.attributes || {},
      confidence: 0.85, // High confidence for actual AI
      similarItems: await findSimilarItems(parsedContent.name || 'Unknown Product', parsedContent.category || '')
    };

    return recognizedItem;
  } catch (error) {
    console.error('Error analyzing image with OpenAI:', error);
    
    // Fall back to a generic item if OpenAI fails
    return {
      name: 'Unknown Product',
      sku: generateRandomSku(),
      description: 'Product details could not be determined. The AI service encountered an error.',
      price: 0,
      quantity: 1,
      confidence: 0.1,
      similarItems: []
    };
  }
}

/**
 * Parse a price string into a number
 * @param priceStr - Price as string, possibly with currency symbols
 * @returns Price as a number
 */
function parsePrice(priceStr: string | number | undefined): number {
  if (priceStr === undefined) return 0;
  
  if (typeof priceStr === 'number') return priceStr;
  
  // Extract numbers from the string
  const matches = priceStr.match(/(\d+([.,]\d+)?)/);
  if (matches && matches[1]) {
    return parseFloat(matches[1].replace(',', '.'));
  }
  
  return 0;
}

/**
 * Generate a random SKU for fallback
 * @returns Random SKU string
 */
function generateRandomSku(): string {
  return `SKU${Math.floor(10000 + Math.random() * 90000)}`;
}

/**
 * Find similar items in the inventory
 * @param name - Product name to match
 * @param category - Product category to match
 * @returns Array of similar items
 */
async function findSimilarItems(name: string, category: string): Promise<Array<{
  id: number;
  name: string;
  similarity: number;
}>> {
  try {
    // Fetch some existing items
    const items = await storage.getAllInventoryItems();
    
    if (items.length === 0) {
      return [];
    }
    
    // Find similar items based on name or category
    const similarItems = items
      .filter(item => {
        // Simple similarity check - in a real application you would use more sophisticated algorithms
        const nameSimilarity = item.name.toLowerCase().includes(name.toLowerCase()) ||
                              name.toLowerCase().includes(item.name.toLowerCase());
        
        // Get category name if available
        let categoryMatch = false;
        if (item.categoryId && category) {
          const itemCategory = storage.getCategory(item.categoryId);
          if (itemCategory) {
            categoryMatch = itemCategory.name.toLowerCase().includes(category.toLowerCase()) ||
                           category.toLowerCase().includes(itemCategory.name.toLowerCase());
          }
        }
        
        return nameSimilarity || categoryMatch;
      })
      .slice(0, 5) // Limit to 5 similar items
      .map(item => {
        // Calculate similarity score (simplified)
        let score = 0.5; // Base score
        
        if (item.name.toLowerCase().includes(name.toLowerCase()) ||
            name.toLowerCase().includes(item.name.toLowerCase())) {
          score += 0.3;
        }
        
        return {
          id: item.id,
          name: item.name,
          similarity: parseFloat(score.toFixed(2))
        };
      });
    
    return similarItems;
  } catch (error) {
    console.error('Error finding similar items:', error);
    return [];
  }
}

/**
 * Generate product description using AI
 * @param productDetails - Basic product details
 * @returns AI-generated description
 */
export async function generateProductDescription(productDetails: {
  name: string;
  category?: string;
  attributes?: Record<string, any>;
}): Promise<string> {
  if (!isConfigured) {
    // Return a template description if OpenAI is not configured
    return `${productDetails.name} - High-quality product for your inventory.`;
  }
  
  try {
    const prompt = `
      Generate a detailed product description for the following product:
      Name: ${productDetails.name}
      ${productDetails.category ? `Category: ${productDetails.category}` : ''}
      ${productDetails.attributes ? `Attributes: ${JSON.stringify(productDetails.attributes)}` : ''}
      
      The description should be professional, informative, and suitable for an inventory management system.
      Keep it under 200 words and highlight key features and benefits.
    `;
    
    const response = await fetch(`${OPENAI_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          { role: 'user', content: prompt }
        ],
        max_tokens: 250,
        temperature: 0.7
      })
    });
    
    if (!response.ok) {
      throw new Error(`OpenAI API Error: ${response.status}`);
    }
    
    const data = await response.json() as any;
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error('Error generating product description:', error);
    return `${productDetails.name} - High-quality product for your inventory.`;
  }
}