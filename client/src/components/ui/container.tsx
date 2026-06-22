import React from 'react';
import { cn } from '@/lib/utils';

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * Container component for consistent layout and spacing
 * 
 * This component provides consistent horizontal padding and maximum width
 * for content, creating a responsive container that works well on different screen sizes.
 */
export function Container({ children, className, ...props }: ContainerProps) {
  return (
    <div
      className={cn('container px-4 md:px-6 mx-auto max-w-7xl', className)}
      {...props}
    >
      {children}
    </div>
  );
}