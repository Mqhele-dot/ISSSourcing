/**
 * Image Recognition Page
 * 
 * This page provides a dedicated interface for using AI image recognition 
 * to add new inventory items by simply uploading images of products.
 */

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { ImageRecognitionUpload } from '@/components/inventory/image-recognition-upload';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Camera, Info, AlertTriangle, Zap, Server, Database, Image } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';


export default function ImageRecognitionPage() {
  const { toast } = useToast();

  // Check if the image recognition service is configured
  const { data: serviceStatus, isLoading, error } = useQuery({
    queryKey: ['/api/inventory/image-recognition/status'],
    queryFn: async () => {
      try {
        const response = await apiRequest('GET', '/api/inventory/image-recognition/status');
        return await response.json();
      } catch (error) {
        throw new Error('Failed to check image recognition service status');
      }
    }
  });

  // Handle requesting API key
  const handleRequestApiKey = () => {
    ask_secrets(['OPENAI_API_KEY'], 'To enable AI-powered image recognition, we need an OpenAI API key with vision capabilities.')
      .then(() => {
        // After API key is set, refresh the status
        window.location.reload();
      })
      .catch(error => {
        toast({
          title: 'API Key Request Failed',
          description: error.message || 'Could not request API key',
          variant: 'destructive',
        });
      });
  };

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center">
            <Camera className="mr-2 h-6 w-6" />
            AI Image Recognition
          </h1>
          <p className="text-muted-foreground mt-1">
            Use AI to identify products and add them to inventory from images
          </p>
        </div>
      </div>

      {/* Service Status */}
      {!isLoading && !error && serviceStatus && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center">
              <Server className="mr-2 h-5 w-5" />
              Service Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <div className="text-sm font-medium">Recognition Status</div>
                <div className="flex items-center">
                  {serviceStatus.status.configured ? (
                    <Badge className="bg-green-100 text-green-800 hover:bg-green-200">
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      Simulation Mode
                    </Badge>
                  )}
                </div>
              </div>
              
              <div className="space-y-1">
                <div className="text-sm font-medium">Provider</div>
                <div className="flex items-center">
                  {serviceStatus.status.provider}
                </div>
              </div>
              
              <div className="space-y-1">
                <div className="text-sm font-medium">Mode</div>
                <div className="flex items-center">
                  {serviceStatus.status.mode}
                  {!serviceStatus.status.configured && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-2 h-7 text-xs"
                      onClick={handleRequestApiKey}
                    >
                      Add API Key
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {!serviceStatus.status.configured && (
              <Alert className="mt-4" variant="warning">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Using Simulation Mode</AlertTitle>
                <AlertDescription>
                  The image recognition service is running in simulation mode because the OpenAI API key is not configured.
                  Responses will be simulated rather than using actual AI analysis.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Main content */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
          <ImageRecognitionUpload standalone={true} />
        </div>
        
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center">
                <Info className="mr-2 h-5 w-5" />
                How It Works
              </CardTitle>
              <CardDescription>
                Understanding AI image recognition for inventory
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-start">
                  <div className="bg-primary/10 p-2 rounded-full mr-3 mt-0.5">
                    <Camera className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-medium">Upload Product Image</h3>
                    <p className="text-sm text-muted-foreground">
                      Take a photo or upload an image of your inventory item
                    </p>
                  </div>
                </div>
                
                <Separator />
                
                <div className="flex items-start">
                  <div className="bg-primary/10 p-2 rounded-full mr-3 mt-0.5">
                    <Zap className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-medium">AI Analyzes Image</h3>
                    <p className="text-sm text-muted-foreground">
                      Our AI recognizes the product and extracts key attributes
                    </p>
                  </div>
                </div>
                
                <Separator />
                
                <div className="flex items-start">
                  <div className="bg-primary/10 p-2 rounded-full mr-3 mt-0.5">
                    <Image className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-medium">Review Results</h3>
                    <p className="text-sm text-muted-foreground">
                      Verify and adjust the identified product information
                    </p>
                  </div>
                </div>
                
                <Separator />
                
                <div className="flex items-start">
                  <div className="bg-primary/10 p-2 rounded-full mr-3 mt-0.5">
                    <Database className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-medium">Add to Inventory</h3>
                    <p className="text-sm text-muted-foreground">
                      Save the identified product to your inventory system
                    </p>
                  </div>
                </div>
              </div>
              
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Pro Tip</AlertTitle>
                <AlertDescription>
                  For best results, make sure your product is well-lit and the image is clear. Position the product against a simple background.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}