/**
 * Profile Picture Controller
 * 
 * Handles profile picture upload, update, and removal operations
 */

import { Request, Response } from 'express';
import { storage } from '../storage';
import { deleteCloudinaryImage, getPublicIdFromUrl } from '../services/cloudinary-service';

/**
 * Upload a profile picture
 * This endpoint receives the uploaded file from multer/cloudinary middleware
 * and updates the user's profile with the new picture URL
 */
export async function uploadProfilePicture(req: Request, res: Response) {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    
    // Get the uploaded file URL from Cloudinary (added by multer-storage-cloudinary)
    const imageUrl = req.file.path;
    
    // Get the current user's profile picture to check if we need to delete an old one
    const user = await storage.getUser(req.user.id);
    
    // If the user already has a profile picture, delete it from Cloudinary
    if (user && user.profilePicture) {
      const publicId = getPublicIdFromUrl(user.profilePicture);
      if (publicId) {
        try {
          await deleteCloudinaryImage(publicId);
        } catch (error) {
          console.error('Failed to delete old profile picture:', error);
          // Continue even if deletion fails
        }
      }
    }
    
    // Update the user's profile picture in the database
    const updatedUser = await storage.updateProfilePicture(req.user.id, imageUrl);
    
    // Return success with the updated user info (excluding sensitive data)
    const { password, ...userWithoutPassword } = updatedUser;
    res.status(200).json({
      success: true,
      message: 'Profile picture uploaded successfully',
      user: userWithoutPassword,
      imageUrl
    });
  } catch (error) {
    console.error('Error uploading profile picture:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to upload profile picture'
    });
  }
}

/**
 * Remove a profile picture
 * Deletes the current profile picture from Cloudinary and removes the URL from the user's profile
 */
export async function removeProfilePicture(req: Request, res: Response) {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    
    // Get the current user with their profile picture
    const user = await storage.getUser(req.user.id);
    
    if (!user || !user.profilePicture) {
      return res.status(400).json({ success: false, message: 'No profile picture to remove' });
    }
    
    // Delete the image from Cloudinary
    const publicId = getPublicIdFromUrl(user.profilePicture);
    if (publicId) {
      try {
        await deleteCloudinaryImage(publicId);
      } catch (error) {
        console.error('Failed to delete profile picture from Cloudinary:', error);
        // Continue even if Cloudinary deletion fails
      }
    }
    
    // Update the user's profile to remove the profile picture URL
    const updatedUser = await storage.updateProfilePicture(req.user.id, null);
    
    // Return success with the updated user info (excluding sensitive data)
    const { password, ...userWithoutPassword } = updatedUser;
    res.status(200).json({
      success: true,
      message: 'Profile picture removed successfully',
      user: userWithoutPassword
    });
  } catch (error) {
    console.error('Error removing profile picture:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to remove profile picture'
    });
  }
}