/**
 * Image Recognition Upload Component
 * 
 * This component provides a UI for uploading images of inventory items
 * to be analyzed by the AI image recognition service.
 */

import { useState, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Upload, Camera, Check, X, RefreshCw, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

interface ImageRecognitionUploadProps {
  onItemCreated?: (newItem: any) => void;
  standalone?: boolean;
}

// Schema for the additional item data form
const additionalItemDataSchema = z.object({
  price: z.string().optional().transform(val => val ? parseFloat(val) : 0),
  quantity: z.string().optional().transform(val => val ? parseInt(val, 10) : 0),
  lowStockThreshold: z.string().optional().transform(val => val ? parseInt(val, 10) : null),
  location: z.string().optional(),
  categoryId: z.string().optional().transform(val => val ? parseInt(val, 10) : null),
  notes: z.string().optional(),
});

export function ImageRecognitionUpload({ onItemCreated, standalone = false }: ImageRecognitionUploadProps) {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [recognizedData, setRecognizedData] = useState<any | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [detectText, setDetectText] = useState(true);
  const [generateDescription, setGenerateDescription] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Form for additional item data
  const form = useForm({
    resolver: zodResolver(additionalItemDataSchema),
    defaultValues: {
      price: '',
      quantity: '',
      lowStockThreshold: '',
      location: '',
      categoryId: '',
      notes: '',
    },
  });

  // Analyze image mutation
  const analyzeImageMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('detectText', detectText.toString());
      formData.append('generateDescription', generateDescription.toString());

      // Simulated progress updates
      const progressUpdates = [25, 50, 75, 99];
      let progressIndex = 0;
      const progressInterval = setInterval(() => {
        if (progressIndex < progressUpdates.length) {
          setUploadProgress(progressUpdates[progressIndex]);
          progressIndex++;
        } else {
          clearInterval(progressInterval);
        }
      }, 500);

      try {
        const response = await apiRequest('POST', '/api/inventory/image-recognition/analyze', formData, {
          headers: {
            // Don't set Content-Type header when using FormData
            // Browser will set it automatically with proper boundary
          },
        });
        
        clearInterval(progressInterval);
        setUploadProgress(100);
        
        const data = await response.json();
        return data;
      } catch (error) {
        clearInterval(progressInterval);
        setUploadProgress(0);
        throw error;
      }
    },
    onSuccess: (data) => {
      setRecognizedData(data.recognizedItem);
      toast({
        title: 'Image Analyzed',
        description: 'Image successfully analyzed by AI.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Analysis Failed',
        description: error.message || 'Failed to analyze image',
        variant: 'destructive',
      });
    },
  });

  // Create item from recognized data mutation
  const createItemMutation = useMutation({
    mutationFn: async (itemData: any) => {
      const response = await apiRequest('POST', '/api/inventory/image-recognition/create', itemData);
      return await response.json();
    },
    onSuccess: (data) => {
      toast({
        title: 'Item Created',
        description: 'New inventory item created from image.',
      });
      
      // Reset the component state
      setImageFile(null);
      setImagePreview(null);
      setRecognizedData(null);
      setUploadProgress(0);
      form.reset();
      
      // Notify parent component if callback provided
      if (onItemCreated) {
        onItemCreated(data.item);
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Creation Failed',
        description: error.message || 'Failed to create item',
        variant: 'destructive',
      });
    },
  });

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImageFile(file);
      
      // Create a preview URL
      const reader = new FileReader();
      reader.onload = (event) => {
        setImagePreview(event.target?.result as string);
      };
      reader.readAsDataURL(file);
      
      // Reset previous recognition data
      setRecognizedData(null);
    }
  };

  // Handle camera/file upload button
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  // Handle analyze button
  const handleAnalyzeClick = () => {
    if (imageFile) {
      analyzeImageMutation.mutate(imageFile);
    }
  };

  // Handle create item button
  const handleCreateItem = form.handleSubmit((additionalData) => {
    if (recognizedData) {
      createItemMutation.mutate({
        recognizedItem: recognizedData,
        additionalData,
      });
    }
  });

  // Reset the component
  const handleReset = () => {
    setImageFile(null);
    setImagePreview(null);
    setRecognizedData(null);
    setUploadProgress(0);
    form.reset();
  };

  return (
    <Card className={standalone ? 'max-w-2xl mx-auto' : ''}>
      <CardHeader>
        <CardTitle className="text-xl flex items-center">
          <ImageIcon className="mr-2 h-5 w-5" />
          AI Image Recognition
        </CardTitle>
        <CardDescription>
          Upload an image to automatically identify inventory items
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Image upload area */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border rounded-lg p-4 flex flex-col items-center justify-center min-h-[200px]">
            {imagePreview ? (
              <div className="relative w-full">
                <img 
                  src={imagePreview} 
                  alt="Item preview" 
                  className="mx-auto max-h-48 object-contain"
                />
                <Button 
                  variant="destructive" 
                  size="icon" 
                  className="absolute top-0 right-0 h-6 w-6"
                  onClick={handleReset}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="text-center">
                <div className="mb-4">
                  <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground" />
                </div>
                <div className="text-sm text-muted-foreground mb-4">
                  Upload an image to identify the item
                </div>
                <Button onClick={handleUploadClick} className="w-full">
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Image
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>
            )}
          </div>
          
          <div className="border rounded-lg p-4 flex flex-col">
            <div className="text-sm font-medium mb-2">Recognition Options</div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="detect-text">Detect Text</Label>
                  <p className="text-xs text-muted-foreground">
                    Read text from labels or packaging
                  </p>
                </div>
                <Switch 
                  id="detect-text" 
                  checked={detectText} 
                  onCheckedChange={setDetectText}
                />
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="generate-description">Generate Description</Label>
                  <p className="text-xs text-muted-foreground">
                    AI creates a detailed description
                  </p>
                </div>
                <Switch 
                  id="generate-description" 
                  checked={generateDescription} 
                  onCheckedChange={setGenerateDescription}
                />
              </div>
            </div>
            
            <Separator className="my-4" />
            
            <div className="mt-auto">
              {analyzeImageMutation.isPending ? (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Analyzing image...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <Progress value={uploadProgress} className="h-2" />
                </div>
              ) : (
                <Button 
                  className="w-full" 
                  disabled={!imageFile || !!recognizedData} 
                  onClick={handleAnalyzeClick}
                >
                  {recognizedData ? (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Analysis Complete
                    </>
                  ) : (
                    <>
                      <Camera className="mr-2 h-4 w-4" />
                      Analyze Image
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
        
        {/* Recognition results */}
        {recognizedData && (
          <div className="mt-4 border rounded-lg p-4">
            <div className="font-medium mb-2">Recognition Results</div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-sm font-medium">Identified Item</div>
                <div className="text-lg">{recognizedData.name}</div>
                {recognizedData.description && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {recognizedData.description}
                  </p>
                )}
              </div>
              
              <div>
                <div className="text-sm font-medium mb-2">Attributes</div>
                <div className="flex flex-wrap gap-2">
                  {recognizedData.category && (
                    <Badge variant="outline">{recognizedData.category}</Badge>
                  )}
                  {recognizedData.attributes && Object.entries(recognizedData.attributes).map(([key, value]) => (
                    <Badge key={key} variant="secondary">
                      {key}: {value as string}
                    </Badge>
                  ))}
                  <Badge className="bg-primary/10 text-primary hover:bg-primary/20">
                    {Math.round(recognizedData.confidence * 100)}% confidence
                  </Badge>
                </div>
                
                {recognizedData.detectedText && (
                  <div className="mt-3">
                    <div className="text-sm font-medium">Detected Text</div>
                    <p className="text-sm text-muted-foreground">
                      {recognizedData.detectedText}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* Additional item data form (shown when item is recognized) */}
        {recognizedData && (
          <Form {...form}>
            <div className="border rounded-lg p-4">
              <div className="font-medium mb-2">Additional Item Details</div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="price"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Price</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          step="0.01" 
                          placeholder="0.00" 
                          {...field} 
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="quantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Initial Quantity</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          placeholder="0" 
                          {...field} 
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="lowStockThreshold"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Low Stock Threshold</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          placeholder="Optional" 
                          {...field} 
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Storage Location</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Warehouse A, Shelf B3, etc." 
                          {...field} 
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="categoryId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          placeholder={recognizedData.category ? recognizedData.category : "Category ID"} 
                          {...field} 
                        />
                      </FormControl>
                      <FormDescription>
                        Will use AI-detected category if blank
                      </FormDescription>
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem className="md:col-span-3">
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Additional information about this item" 
                          {...field} 
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </div>
          </Form>
        )}
      </CardContent>
      
      <CardFooter className="flex justify-between">
        <Button 
          variant="outline" 
          onClick={handleReset}
          disabled={!imageFile && !recognizedData}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Reset
        </Button>
        
        <Sheet>
          <SheetTrigger asChild>
            <Button 
              disabled={!recognizedData} 
              onClick={handleCreateItem}
            >
              {createItemMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Create Item
                </>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Item Created Successfully</SheetTitle>
              <SheetDescription>
                The following inventory item has been created based on image recognition:
              </SheetDescription>
            </SheetHeader>
            <div className="py-4">
              {/* This would show details of the created item */}
              <div className="border rounded p-4 mt-4">
                <p className="font-medium">{recognizedData?.name}</p>
                <p className="text-sm text-muted-foreground">{recognizedData?.description}</p>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </CardFooter>
    </Card>
  );
}