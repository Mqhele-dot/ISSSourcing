import React from 'react';

export function Toaster() {
  return (
    <div id="toaster" aria-live="assertive" className="fixed inset-0 z-50 flex pointer-events-none items-end px-4 py-6 sm:items-start sm:p-6">
      <div className="flex flex-col items-center w-full space-y-4 sm:items-end">
        {/* Toast notifications will be dynamically inserted here */}
      </div>
    </div>
  );
}