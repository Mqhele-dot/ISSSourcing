import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Server, Shield, Laptop, Cpu, Database, Wifi, WifiOff, Zap, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { isElectronEnvironment } from '@/lib/electron-bridge';

// Define available platforms
type Platform = 'windows' | 'mac' | 'linux';

// Define download info for each platform
const downloadInfo: Record<Platform, { 
  displayName: string, 
  fileName: string, 
  icon: React.ReactNode, 
  downloadUrl: string,
  fileSize: string,
  architectures: string[]
}> = {
  windows: {
    displayName: 'Windows',
    fileName: 'InvTrack-Setup-1.0.0.exe',
    icon: <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 14H10v7l-7-4V7l7-4v7H6.5C5.5 10 5 9.5 5 9s.5-1 1.5-1H10V1l-7 4v10l7 4v-7H6.5c-1 0-1.5-.5-1.5-1s.5-1 1.5-1Z"/><polyline points="15 1 22 1 22 8"/><polyline points="22 16 22 23 15 23"/><path d="M22 8v8H15"/><path d="M15 16V8h7"/></svg>,
    downloadUrl: 'https://github.com/yourusername/invtrack/releases/download/v1.0.0/InvTrack-Setup-1.0.0.exe',
    fileSize: '75.4 MB',
    architectures: ['x64', 'arm64']
  },
  mac: {
    displayName: 'macOS',
    fileName: 'InvTrack-1.0.0.dmg',
    icon: <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 10a6 6 0 0 1 6 -6"/><path d="M12 19c2 0 3 -1 3 -3"/><path d="M9 19c-2 0 -3 -1 -3 -3"/><path d="M9 19c0 1 0 2 2 3c2 -1 2 -2 2 -3"/><path d="M3 3l18 18"/><path d="M12 6a6 6 0 0 0 -6 6c0 3.5 2.5 6 6 6a6 6 0 0 0 6 -6c0 -3.5 -2.5 -6 -6 -6"/></svg>,
    downloadUrl: 'https://github.com/yourusername/invtrack/releases/download/v1.0.0/InvTrack-1.0.0.dmg',
    fileSize: '78.2 MB',
    architectures: ['x64', 'arm64 (M1/M2)']
  },
  linux: {
    displayName: 'Linux',
    fileName: 'InvTrack-1.0.0.AppImage',
    icon: <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 14c3 0 3 2 3 2v2c0 1.5 1.5 1.5 1.5 1.5h3.5v-10l-5-5h-6l-4 4v10h3.5c1.5 0 1.5-1.5 1.5-1.5v-2s0-2 3-2Z"/><path d="M9 4v4a2 2 0 0 1-2 2h-2"/><path d="M14 4v4a2 2 0 0 0 2 2h2"/></svg>,
    downloadUrl: 'https://github.com/yourusername/invtrack/releases/download/v1.0.0/InvTrack-1.0.0.AppImage',
    fileSize: '72.1 MB',
    architectures: ['x64', 'arm64']
  }
};

// Feature list for the desktop app
const features = [
  {
    title: 'Offline Mode',
    description: 'Work with your inventory even without an internet connection',
    icon: <WifiOff className="h-5 w-5 text-primary" />
  },
  {
    title: 'Faster Performance',
    description: 'Native application with optimized local database access',
    icon: <Zap className="h-5 w-5 text-primary" />
  },
  {
    title: 'Local Database',
    description: 'Store your data locally with regular cloud syncing',
    icon: <Database className="h-5 w-5 text-primary" />
  },
  {
    title: 'Real-time Sync',
    description: 'Changes are automatically synchronized when online',
    icon: <Wifi className="h-5 w-5 text-primary" />
  },
  {
    title: 'Enhanced Security',
    description: 'Additional security features for desktop environments',
    icon: <Shield className="h-5 w-5 text-primary" />
  },
  {
    title: 'System Integration',
    description: 'Deep integration with your operating system',
    icon: <Cpu className="h-5 w-5 text-primary" />
  }
];

// Requirements for desktop app
const requirements = {
  windows: ['Windows 10 or later', '4GB RAM minimum', '500MB free disk space', 'Internet connection for initial setup'],
  mac: ['macOS 10.13 (High Sierra) or later', '4GB RAM minimum', '500MB free disk space', 'Internet connection for initial setup'],
  linux: ['Ubuntu 18.04 or compatible distro', '4GB RAM minimum', '500MB free disk space', 'Internet connection for initial setup']
};

export default function DownloadPage() {
  const { toast } = useToast();
  const [selectedPlatform, setSelectedPlatform] = React.useState<Platform>('windows');
  
  // Detect platform
  React.useEffect(() => {
    const platform = navigator.platform.toLowerCase();
    if (platform.includes('win')) {
      setSelectedPlatform('windows');
    } else if (platform.includes('mac')) {
      setSelectedPlatform('mac');
    } else if (platform.includes('linux')) {
      setSelectedPlatform('linux');
    }
  }, []);
  
  // Handle download button click
  const handleDownload = (platform: Platform) => {
    if (isElectronEnvironment()) {
      toast({
        title: "You're Already Using the Desktop App",
        description: "You're currently using the desktop application version.",
      });
      return;
    }
    
    // In a real app, track download analytics here
    window.open(downloadInfo[platform].downloadUrl, '_blank');
    
    toast({
      title: 'Download Started',
      description: `${downloadInfo[platform].fileName} is being downloaded.`,
    });
  };
  
  return (
    <div className="container px-4 py-6 mx-auto max-w-7xl">
      <div className="flex flex-col items-center text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">Download InvTrack Desktop</h1>
        <p className="text-lg text-muted-foreground max-w-2xl">
          Get the desktop version for enhanced performance, offline capabilities, and seamless integration with your operating system.
        </p>
      </div>
      
      {isElectronEnvironment() ? (
        <Card className="mb-12 border-primary/50">
          <CardContent className="pt-6 pb-6">
            <div className="flex flex-col md:flex-row items-center gap-4">
              <div className="bg-primary/10 p-4 rounded-full">
                <Check className="h-8 w-8 text-primary" />
              </div>
              <div className="text-center md:text-left">
                <h2 className="text-xl font-semibold mb-2">You're Already Using the Desktop App!</h2>
                <p className="text-muted-foreground">
                  You're currently using the desktop version of InvTrack with all its benefits and features.
                </p>
              </div>
              <div className="ml-auto hidden md:block">
                <Button 
                  variant="outline" 
                  onClick={() => window.open('https://github.com/yourusername/invtrack/releases', '_blank')}
                >
                  Check for Updates
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {Object.entries(downloadInfo).map(([platform, info]) => (
            <Card 
              key={platform} 
              className={`${selectedPlatform === platform ? 'border-primary/50 bg-primary/5' : ''} hover:border-primary/30 transition-colors cursor-pointer`}
              onClick={() => setSelectedPlatform(platform as Platform)}
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-3">
                  {info.icon}
                  <span>{info.displayName}</span>
                </CardTitle>
                <CardDescription>
                  Version 1.0.0 • {info.fileSize}
                </CardDescription>
              </CardHeader>
              <CardContent className="pb-2">
                <p className="text-xs text-muted-foreground">
                  Supported architectures: {info.architectures.join(', ')}
                </p>
              </CardContent>
              <CardFooter>
                <Button 
                  className="w-full" 
                  onClick={() => handleDownload(platform as Platform)}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-12">
        {/* Features section */}
        <div>
          <h2 className="text-2xl font-bold mb-6">Desktop Features</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {features.map((feature, index) => (
              <Card key={index} className="hover:bg-muted/50 transition-colors">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <div className="bg-primary/10 p-2 rounded-md">
                      {feature.icon}
                    </div>
                    <div>
                      <h3 className="font-medium">{feature.title}</h3>
                      <p className="text-sm text-muted-foreground">{feature.description}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
        
        {/* System requirements & instructions */}
        <div>
          <h2 className="text-2xl font-bold mb-6">System Requirements</h2>
          <Card>
            <CardHeader>
              <CardTitle>
                <div className="flex items-center gap-2">
                  <Laptop className="h-5 w-5" />
                  {downloadInfo[selectedPlatform].displayName} Requirements
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {requirements[selectedPlatform].map((req, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" />
                    <span className="text-sm">{req}</span>
                  </li>
                ))}
              </ul>
              
              <div className="mt-6 p-4 bg-muted rounded-md">
                <h3 className="font-medium mb-2">Installation Instructions</h3>
                <ol className="text-sm space-y-2 list-decimal pl-4">
                  <li>Download the installer for your platform</li>
                  <li>Run the installer and follow the on-screen instructions</li>
                  <li>Launch InvTrack and sign in with your existing account</li>
                  <li>Your data will automatically sync from the cloud</li>
                </ol>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      
      <div className="bg-muted p-6 rounded-lg">
        <div className="flex flex-col md:flex-row gap-6 items-center">
          <div>
            <h2 className="text-xl font-bold mb-2">Need Help?</h2>
            <p className="text-muted-foreground">
              If you encounter any issues with the desktop app, please visit our help center or contact support.
            </p>
          </div>
          <div className="flex gap-4 ml-auto">
            <Button variant="outline" onClick={() => window.open('https://help.invtrack.example.com', '_blank')}>
              Help Center
            </Button>
            <Button onClick={() => window.open('mailto:support@invtrack.example.com')}>
              Contact Support
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}