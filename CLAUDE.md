# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Development
- `pnpm install` - Install dependencies
- `pnpm run dev` - Start development server (localhost:3000)
- `pnpm run build` - Build the application
- `pnpm run start` - Start production server
- `pnpm run lint` - Run ESLint

### Database Operations
- `pnpm run db:generate` - Generate Drizzle schema files
- `pnpm run db:push` - Push schema changes to Neon database
- `pnpm run db:studio` - Open Drizzle Studio
- `pnpm run db:migrate` - Run migrations
- `pnpm run db:pull` - Pull schema from database
- `npx @better-auth/cli generate` - Generate Better Auth schema (copy to schema.ts)

## Architecture Overview

### Application Structure
This is a Next.js 15 application using the App Router with Better Auth for authentication and a canvas-based visual editor.

**Key Directories:**
- `src/app/` - Next.js App Router pages and API routes
- `src/components/` - React components organized by feature
- `src/lib/` - Utility functions and configurations
- `src/db/` - Database schema and connection (Drizzle ORM + Neon PostgreSQL)
- `src/hooks/` - Custom React hooks
- `src/server/` - Server-side utilities

### Authentication System
- **Better Auth** with Drizzle adapter
- Social providers: Google, GitHub
- Magic link authentication via Resend
- Anonymous authentication support
- Database tables: `user`, `session`, `account`

### Canvas Editor Architecture
The core feature is a visual canvas editor located in `src/components/dashboard/canvas/`:

**Canvas Components:**
- `canvas-designer.tsx` - Main layout container with sidebars
- `canvas-area.tsx` - Interactive drawing canvas with component positioning
- `canvas-context.tsx` - React Context for canvas state management
- `component-library.tsx` - Draggable component palette
- `properties-panel.tsx` - Component property editor
- `template-selector.tsx` - Pre-built template selection
- `toolbar.tsx` - Canvas tools and actions

**Canvas State Management:**
- Uses React Context + useReducer pattern
- State includes: components array, selection, canvas dimensions, zoom/pan, history
- Component types: button, text, input, image
- Each component has: id, type, position (x,y), dimensions, properties

### UI Framework
- **Tailwind CSS** with custom theming
- **Radix UI** primitives via Shadcn/ui components
- **Next Themes** for dark/light mode support
- Custom theme colors: Dark mode uses #171717 backgrounds, #292929 borders

### Database Schema
- PostgreSQL via Neon with Drizzle ORM
- Authentication tables managed by Better Auth
- User management with role-based access

## Environment Setup

Required environment variables:
```
DATABASE_URL=          # Neon PostgreSQL connection
BETTER_AUTH_SECRET=    # Better Auth secret key
BETTER_AUTH_URL=       # Base URL (http://localhost:3000 for dev)
GOOGLE_CLIENT_ID=      # Google OAuth credentials
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=      # GitHub OAuth credentials  
GITHUB_CLIENT_SECRET=
RESEND_API_KEY=        # Email service for magic links
```

## Development Patterns

### Theme Awareness
Canvas components use the `useTheme` hook from 'next-themes' to adapt to dark/light modes. Always check `resolvedTheme` and apply conditional styling.

### Component Structure
- Server Components by default (Next.js 15)
- Client Components only when needed for interactivity
- TypeScript interfaces for all component props
- Functional components with descriptive naming

### Canvas Development
- Canvas state is managed through `CanvasContext`
- Components are positioned absolutely with x,y coordinates
- All canvas interactions go through the context reducer
- Theme-aware colors for all canvas elements and UI panels

## Package Management
- Uses **pnpm** as package manager
- Shadcn/ui components: `npx shadcn@latest add [component]`
- Better Auth CLI for schema generation

## Current Features
- Multi-layout dashboard with authentication
- Visual canvas editor for UI design
- Component library with drag-and-drop
- Properties panel for component editing
- Template system for pre-built layouts
- Theme switching with custom brand colors
- User management and role-based access