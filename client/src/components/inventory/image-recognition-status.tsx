import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle, Info } from 'lucide-react';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription 
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Component that displays the status of the image recognition service
 */
const ImageRecognitionStatus: React.FC = () => {
  // Query the status of the image recognition service
  const { data, isLoading, error } = useQuery({
    queryKey: ['/api/image-recognition/status'],
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  if (isLoading) {
    return (
      <Card className="mb-4 border border-gray-200">
        <CardHeader className="pb-2">
          <Skeleton className="h-6 w-56 mb-2" />
          <Skeleton className="h-4 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="mb-4 border border-red-200 bg-red-50">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-500" />
            Image Recognition Error
          </CardTitle>
          <CardDescription>Unable to check image recognition status</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-800">
            There was an error checking the image recognition service status. This may indicate a connectivity issue.
          </p>
        </CardContent>
      </Card>
    );
  }

  const status = data?.status || 'unknown';
  const mode = data?.mode || 'Unknown';
  const aiProvider = data?.aiProvider || 'None';
  const message = data?.message || 'Status information not available';

  // UI variants based on status
  const variants = {
    operational: {
      icon: <CheckCircle className="h-5 w-5 text-green-500" />,
      title: 'AI Image Recognition Active',
      badgeVariant: 'success',
      badgeText: 'Operational',
      cardStyles: 'border-green-200 bg-green-50',
    },
    simulation: {
      icon: <Info className="h-5 w-5 text-amber-500" />,
      title: 'Simulation Mode Active',
      badgeVariant: 'warning',
      badgeText: 'Simulation',
      cardStyles: 'border-amber-200 bg-amber-50',
    },
    error: {
      icon: <AlertCircle className="h-5 w-5 text-red-500" />,
      title: 'Service Unavailable',
      badgeVariant: 'destructive',
      badgeText: 'Error',
      cardStyles: 'border-red-200 bg-red-50',
    },
    unknown: {
      icon: <Info className="h-5 w-5 text-gray-500" />,
      title: 'Status Unknown',
      badgeVariant: 'outline',
      badgeText: 'Unknown',
      cardStyles: 'border-gray-200',
    },
  };

  // Get the appropriate UI variant based on status
  const variant = variants[status as keyof typeof variants] || variants.unknown;

  return (
    <Card className={`mb-4 ${variant.cardStyles}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center justify-between">
          <span className="flex items-center gap-2">
            {variant.icon}
            {variant.title}
          </span>
          <Badge variant={variant.badgeVariant as any}>{variant.badgeText}</Badge>
        </CardTitle>
        <CardDescription>
          Provider: {aiProvider} | Mode: {mode}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger className="w-full text-left">
              <p className="text-sm">{message}</p>
            </TooltipTrigger>
            <TooltipContent>
              {status === 'simulation' ? (
                <p className="max-w-xs">
                  To enable real AI image recognition, set the OPENAI_API_KEY environment variable.
                  Contact your administrator for more information.
                </p>
              ) : (
                <p className="max-w-xs">{message}</p>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
};

export default ImageRecognitionStatus;