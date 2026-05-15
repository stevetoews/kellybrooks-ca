import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const paintings = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/paintings' }),
  schema: z.object({
    title: z.string(),
    image: z.string(),
    size: z.string().optional(),
    media: z.string().optional(),
    order: z.number().optional(),
    date: z.string().optional(),
  }),
});

const shows = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/shows' }),
  schema: z.object({
    title: z.string(),
    date: z.string().optional(),
    image: z.string().optional(),
    gallery: z.array(z.string()).optional(),
  }),
});

const blog = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    date: z.string(),
    image: z.string().optional(),
  }),
});

export const collections = { paintings, shows, blog };
