declare module 'qrcode' {
  export interface QRCodeToStringOptions {
    type?: string;
    color?: {
      dark?: string;
      light?: string;
    };
    width?: number;
    margin?: number;
    small?: boolean;
  }

  export interface QRCodeRenderersOptions {
    margin?: number;
    scale?: number;
    width?: number;
    color?: {
      dark?: string;
      light?: string;
    };
    errorCorrectionLevel?: 'low' | 'medium' | 'quartile' | 'high' | 'L' | 'M' | 'Q' | 'H';
  }

  export function toCanvas(
    canvasElement: HTMLCanvasElement,
    text: string,
    options?: QRCodeRenderersOptions
  ): Promise<HTMLCanvasElement>;

  export function toCanvas(
    text: string,
    options?: QRCodeRenderersOptions
  ): Promise<HTMLCanvasElement>;

  export function toDataURL(
    text: string,
    options?: QRCodeRenderersOptions
  ): Promise<string>;

  export function toString(
    text: string,
    options?: QRCodeToStringOptions
  ): Promise<string>;

  export class canvas {
    static create(size: number): any;
    static createStringTag(size: number, data: string, margin: number): string;
  }
}