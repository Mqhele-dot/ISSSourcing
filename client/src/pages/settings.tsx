import React from 'react';
import { DesktopLayout } from '../components/layout/desktop-layout';
import { LocalDatabaseInfo } from '../components/electron/local-database-info';
import { useElectron } from '../contexts/electron-provider';
import { Settings as SettingsIcon, Database, Cloud, Lock } from 'lucide-react';

const Settings: React.FC = () => {
  const { isElectron } = useElectron();
  
  return (
    <DesktopLayout title="Settings">
      <div className="container p-6 max-w-5xl">
        <div className="flex items-center mb-6">
          <SettingsIcon className="h-6 w-6 mr-2 text-primary" />
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-1">
            <div className="space-y-1">
              <h3 className="text-lg font-medium">Categories</h3>
              <nav className="flex flex-col space-y-1">
                <a href="#general" className="flex items-center px-3 py-2 text-sm rounded-md bg-primary/10 text-primary">
                  <SettingsIcon className="h-4 w-4 mr-2" />
                  General
                </a>
                <a href="#database" className="flex items-center px-3 py-2 text-sm rounded-md hover:bg-muted">
                  <Database className="h-4 w-4 mr-2" />
                  Database
                </a>
                <a href="#sync" className="flex items-center px-3 py-2 text-sm rounded-md hover:bg-muted">
                  <Cloud className="h-4 w-4 mr-2" />
                  Synchronization
                </a>
                <a href="#security" className="flex items-center px-3 py-2 text-sm rounded-md hover:bg-muted">
                  <Lock className="h-4 w-4 mr-2" />
                  Security
                </a>
              </nav>
            </div>
          </div>
          
          <div className="md:col-span-2 space-y-6">
            <section id="general">
              <h2 className="text-xl font-bold mb-4">General Settings</h2>
              {/* General settings content */}
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">
                  General application settings will appear here.
                </p>
              </div>
            </section>
            
            <section id="database">
              <h2 className="text-xl font-bold mb-4">Database</h2>
              {isElectron ? (
                <LocalDatabaseInfo />
              ) : (
                <div className="rounded-lg border p-4 bg-muted/40">
                  <p className="text-sm text-muted-foreground">
                    Local database is only available in the desktop application.
                  </p>
                </div>
              )}
            </section>
            
            <section id="sync">
              <h2 className="text-xl font-bold mb-4">Synchronization</h2>
              {/* Sync settings content */}
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">
                  Synchronization settings will appear here.
                </p>
              </div>
            </section>
            
            <section id="security">
              <h2 className="text-xl font-bold mb-4">Security</h2>
              {/* Security settings content */}
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">
                  Security settings will appear here.
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </DesktopLayout>
  );
};

export default Settings;