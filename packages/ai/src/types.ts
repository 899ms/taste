export type ModelId = string;

export type TasteImage = {
  id: string;
  basename: string;
  width: number | null;
  height: number | null;
  bytes?: number | null;
};

export type ImageInput = {
  bytes: Uint8Array;
  mediaType: string;
};

export type TextGenerationResult = {
  text: string;
  model: string;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
};

export type RawAnalysisInput = {
  image: TasteImage;
  imageInput: ImageInput;
  model: ModelId;
  aiGatewayToken: string;
};

export type SynthesizeImageNoteInput = {
  image: TasteImage;
  imageInput: ImageInput;
  analyses: Array<{
    model: ModelId;
    text: string;
  }>;
  model: ModelId;
  aiGatewayToken: string;
};

export type ChunkSpec = {
  id: string;
  notes: Array<{
    imageId: string;
    file: string;
    text: string;
  }>;
};

export type RuleChunkResult = {
  id: string;
  files: string[];
  text: string;
};
