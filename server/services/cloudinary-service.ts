/**
 * Cloudinary Service
 * 
 * This service manages the interaction with Cloudinary for image uploads, 
 * particularly focused on profile pictures.
 */

import type { UploadApiOptions } from "cloudinary";
import { v2 as cloudinary } from "cloudinary";
import type { Request } from "express";
import multer from "multer";

function cloudinaryProfilePictureUploadOptions(req: Request): UploadApiOptions {
  const userId = req.user?.id ?? "anonymous";
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;

  return {
    folder: "inventory_app/profile_pictures",
    allowed_formats: ["jpg", "png", "jpeg", "gif"],
    transformation: [{ width: 500, height: 500, crop: "limit" }],
    public_id: `user_${userId}_${uniqueSuffix}`,
  };
}

/** Multer storage that streams uploads to Cloudinary (avoids vulnerable `multer-storage-cloudinary` chain). */
const profilePicturesStorage: multer.StorageEngine = {
  _handleFile(req: Request, file: Express.Multer.File, cb) {
    const opts = cloudinaryProfilePictureUploadOptions(req);
    const stream = cloudinary.uploader.upload_stream(
      opts,
      (err, result) => {
        if (err) return cb(err);
        if (!result?.secure_url) return cb(new Error("Cloudinary upload returned no secure_url"));
        const path = String(result.secure_url);
        const filename = typeof result.public_id === "string" ? result.public_id : path.split("/").pop() ?? "";
        cb(null, {
          path,
          filename,
          destination: "",
          encoding: file.encoding,
          mimetype: file.mimetype,
          fieldname: file.fieldname,
          originalname: file.originalname,
          size:
            typeof result.bytes === "number"
              ? result.bytes
              : typeof file.size === "number"
                ? file.size
                : 0,
        });
      },
    );
    file.stream.pipe(stream);
  },
  _removeFile(_req, _file, cb) {
    cb(null);
  },
};

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer upload configuration for profile pictures
export const profilePictureUpload = multer({
  storage: profilePicturesStorage,
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