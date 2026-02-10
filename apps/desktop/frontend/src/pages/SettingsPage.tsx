import React, { useState } from 'react';
import { Card, Button, Select, Toast } from '../components/ui';
import { useTheme, Accent } from '../theme/ThemeProvider';

const paletteBg: Record<Accent, string> = {
  ocean: 'linear-gradient(135deg, hsl(202 89% 46%), hsl(222 78% 54%))',
  mango: 'linear-gradient(135deg, hsl(29 92% 53%), hsl(12 86% 56%))',
  violet: 'linear-gradient(135deg, hsl(262 84% 62%), hsl(282 82% 61%))',
  emerald: 'linear-gradient(135deg, hsl(154 74% 42%), hsl(172 74% 40%))',
  crimson: 'linear-gradient(135deg, hsl(346 84% 56%), hsl(6 86% 56%))',
};

export function SettingsPage() {
  const { theme, accent, density, fontScale, setTheme, setAccent, setDensity, setFontScale, resetDefaults } = useTheme();
  const [toast, setToast] = useState<string | null>(null);

  return (
    <div className="panel">
      <div className="page-header">
        <h2 style={{ margin: 0 }}>Settings</h2>
        <p className="muted" style={{ margin: '6px 0 0' }}>Theme, accent, spacing, and readability controls.</p>
      </div>
      <div className="grid-2">
        <Card>
          <h3>Appearance</h3>
          <p className="muted">Theme mode</p>
          <Select value={theme} onChange={(e) => setTheme(e.target.value as any)}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></Select>
          <p className="muted">Accent palette</p>
          <div className="swatches">
            {(Object.keys(paletteBg) as Accent[]).map((name) => (
              <button key={name} className={`swatch ${accent === name ? 'active' : ''}`} style={{ background: paletteBg[name] }} onClick={() => setAccent(name)} title={name} />
            ))}
          </div>
        </Card>
        <Card>
          <h3>Layout & readability</h3>
          <p className="muted">Density</p>
          <Select value={density} onChange={(e) => setDensity(e.target.value as any)}><option value="comfortable">comfortable</option><option value="compact">compact</option></Select>
          <p className="muted">Font scale</p>
          <Select value={fontScale} onChange={(e) => setFontScale(e.target.value as any)}><option value="sm">small</option><option value="md">medium</option><option value="lg">large</option></Select>
          <div style={{ marginTop: 12 }}><Button variant="danger" onClick={() => { if (window.confirm('Reset settings to defaults?')) { resetDefaults(); setToast('Defaults restored'); setTimeout(() => setToast(null), 2200); } }}>Reset to defaults</Button></div>
        </Card>
      </div>
      {toast ? <div className="toast"><Toast text={toast} /></div> : null}
    </div>
  );
}
