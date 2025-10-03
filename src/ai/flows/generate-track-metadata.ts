'use server';

/**
 * @fileOverview Uses generative AI to analyze audio tracks and generate suitable descriptions and other metadata.
 *
 * - generateTrackMetadata - A function that handles the audio track metadata generation process.
 * - GenerateTrackMetadataInput - The input type for the generateTrackMetadata function.
 * - GenerateTrackMetadataOutput - The return type for the generateTrackMetadata function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateTrackMetadataInputSchema = z.object({
  audioDataUri: z
    .string()
    .describe(
      "The audio track as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
  title: z.string().describe('The title of the audio track.'),
  artist: z.string().describe('The artist of the audio track.'),
});
export type GenerateTrackMetadataInput = z.infer<typeof GenerateTrackMetadataInputSchema>;

const GenerateTrackMetadataOutputSchema = z.object({
  description: z.string().describe('A detailed description of the audio track.'),
  genres: z.array(z.string()).describe('A list of genres that the audio track belongs to.'),
  mood: z.string().describe('The overall mood or feeling of the audio track.'),
  key: z.string().describe('The key of the song'),
  tempo: z.number().describe('The tempo of the song in BPM'),
});
export type GenerateTrackMetadataOutput = z.infer<typeof GenerateTrackMetadataOutputSchema>;

export async function generateTrackMetadata(input: GenerateTrackMetadataInput): Promise<GenerateTrackMetadataOutput> {
  return generateTrackMetadataFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateTrackMetadataPrompt',
  input: {schema: GenerateTrackMetadataInputSchema},
  output: {schema: GenerateTrackMetadataOutputSchema},
  prompt: `You are an AI music expert. You will analyze the provided audio track and generate metadata for it.

  The audio track is provided as a data URI. Use your best judgment to extract information about the track.
  Consider the following aspects:

  - Overall mood and feeling
  - Key musical elements
  - Possible genres

  The audio itself is not provided, use the title and artist to inform your description, genres, mood and key.

  Title: {{{title}}}
  Artist: {{{artist}}}

  Output a JSON object with the following keys:
  - description: A detailed description of the audio track.
  - genres: A list of genres that the audio track belongs to.
  - mood: The overall mood or feeling of the audio track.
  - key: The key of the song
  - tempo: The tempo of the song in BPM`,
});

const generateTrackMetadataFlow = ai.defineFlow(
  {
    name: 'generateTrackMetadataFlow',
    inputSchema: GenerateTrackMetadataInputSchema,
    outputSchema: GenerateTrackMetadataOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
