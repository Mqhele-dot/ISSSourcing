import React from 'react';
import { Card, Button, Select } from '../components/ui';
import { useTheme } from '../theme/ThemeProvider';

export function SettingsPage() {
  const { theme, accent, density, fontScale, setTheme, setAccent, setDensity, setFontScale, resetDefaults } = useTheme();
  return (
    <div className="grid-2">
      <Card>
        <h3>Appearance</h3>
        <p className="muted">Theme mode</p>
        <Select value={theme} onChange={(e) => setTheme(e.target.value as any)}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></Select>
        <p className="muted">Accent palette</p>
        <Select value={accent} onChange={(e) => setAccent(e.target.value as any)}><option value="ocean">ocean</option><option value="mango">mango</option><option value="violet">violet</option><option value="emerald">emerald</option><option value="crimson">crimson</option></Select>
      </Card>
      <Card>
        <h3>Layout & readability</h3>
        <p className="muted">Density</p>
        <Select value={density} onChange={(e) => setDensity(e.target.value as any)}><option value="comfortable">comfortable</option><option value="compact">compact</option></Select>
        <p className="muted">Font scale</p>
        <Select value={fontScale} onChange={(e) => setFontScale(e.target.value as any)}><option value="sm">small</option><option value="md">medium</option><option value="lg">large</option></Select>
        <div style={{ marginTop: 12 }}><Button variant="danger" onClick={resetDefaults}>Reset to defaults</Button></div>
      </Card>
    </div>
  );
}
