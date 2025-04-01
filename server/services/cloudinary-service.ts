/**
 * Cloudinary Service
 * 
 * This service manages the interaction with Cloudinary for image uploads, 
 * particularly focused on profile pictures.
 */

import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import { Request } from 'express';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Custom storage configuration for Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'inventory_app/profile_pictures',
    allowed_formats: ['jpg', 'png', 'jpeg', 'gif'],
    transformation: [{ width: 500, height: 500, crop: 'limit' }],
    public_id: (req: Request, file: Express.Multer.File) => {
      // Generate a unique filename based on user ID if available
      const userId = req.user?.id || 'anonymous';
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const filename = `user_${userId}_${uniqueSuffix}`;
      return filename;
    },
  } as any, // Type cast to fix type issues
});

// Multer upload configuration for profile pictures
export const profilePictureUpload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB size limit
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

/**
 * Delete an image from Cloudinary
 * @param publicId The public ID of the image
 * @returns Promise with the deletion result
 */
export async function deleteCloudinaryImage(publicId: string): Promise<any> {
  try {
    // Extract the public ID if it's a full URL
    const extractedPublicId = publicId.includes('/')
      ? publicId.split('/').pop()?.split('.')[0]
      : publicId;
      
    if (!extractedPublicId) {
      throw new Error('Invalid public ID');
    }
    
    return await cloudinary.uploader.destroy(extractedPublicId);
  } catch (error) {
    console.error('Error deleting image from Cloudinary:', error);
    throw error;
  }
}

/**
 * Get the public ID from a Cloudinary URL
 * @param url The full Cloudinary URL
 * @returns The public ID of the image
 */
export function getPublicIdFromUrl(url: string): string | null {
  if (!url) return null;
  
  try {
    // Handle different Cloudinary URL formats
    const matches = url.match(/\/v\d+\/([^/]+)(\/[^/]+)*\/([^/.]+)/);
    if (matches && matches.length >= 4) {
      return `${matches[1]}/${matches[3]}`;
    }
    return null;
  } catch (error) {
    console.error('Error extracting public ID from URL:', error);
    return null;
  }
}

export default cloudinary;