declare module 'gifshot' {
  export interface GifshotOptions {
    images?: (string | HTMLImageElement | HTMLCanvasElement)[];
    video?: string[];
    gifWidth?: number;
    gifHeight?: number;
    text?: string;
    fontWeight?: string;
    fontSize?: string;
    fontFamily?: string;
    fontColor?: string;
    textAlign?: string;
    textBaseline?: string;
    sampleInterval?: number;
    numWorkers?: number;
    frameDuration?: number; // 10 = 1 sec
    numFrames?: number;
    keepCameraOn?: boolean;
    progressCallback?: (captureProgress: number) => void;
    completeCallback?: () => void;
  }

  export function createGIF(
    options: GifshotOptions,
    callback: (obj: { error: boolean; errorCode: string; errorMsg: string; image: string }) => void
  ): void;
}
