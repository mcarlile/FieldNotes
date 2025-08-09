# Field Notes GPX Showcase Application

## Overview

This is a full-stack web application designed to showcase outdoor field notes with integrated GPX track visualization and photo management. The application serves as a portfolio/showcase platform for outdoor adventures, combining trip documentation with interactive maps and photo galleries.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes

**August 9, 2025 - Real EXIF Data Extraction System:**
- ✓ Implemented authentic EXIF extraction using exifr library on server-side
- ✓ Created comprehensive photo metadata processing (GPS, camera settings, timestamps)
- ✓ Enhanced photo upload workflow to extract real camera data from uploaded files
- ✓ Added server-side endpoints for EXIF processing and batch updates
- ✓ Removed all fake/sample EXIF data for testing with real photo uploads
- ✓ Photos now display genuine camera make, model, aperture, shutter speed, ISO, focal length
- ✓ Integrated GPS coordinate extraction for precise photo location mapping
- ✓ Added automatic EXIF processing for new photo uploads

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript and Vite for fast development and building
- **Routing**: Wouter for lightweight client-side routing
- **UI Framework**: Radix UI primitives with Tailwind CSS for styling
- **Design System**: Custom design tokens following Carbon Design System principles
- **State Management**: TanStack Query (React Query) for server state management
- **Map Integration**: Mapbox GL JS for interactive map visualization

### Backend Architecture
- **Runtime**: Node.js with Express.js web framework
- **Language**: TypeScript with ES modules
- **Database**: PostgreSQL with Replit Database (using node-postgres driver) - **MIGRATED AND ACTIVE**
- **ORM**: Drizzle ORM for type-safe database operations
- **API Pattern**: RESTful API design with structured endpoints
- **Object Storage**: Replit Object Storage for photo management with normalized URL serving

### Key Components

#### Database Schema
- **Field Notes Table**: Stores trip metadata including title, description, trip type, date, distance, elevation gain, and GPX data
- **Photos Table**: Stores photo metadata with EXIF data, GPS coordinates, and relationships to field notes
- **Relationships**: One-to-many relationship between field notes and photos

#### Frontend Components
- **Field Note Cards**: Grid-based showcase of outdoor adventures
- **Interactive Map**: Displays GPX tracks and photo locations using Mapbox
- **Photo Lightbox**: Modal gallery for viewing detailed photo information and EXIF data
- **Search & Filtering**: Real-time filtering by search terms, trip type, and sorting options

#### API Endpoints
- `GET /api/field-notes` - Retrieve field notes with optional filtering and sorting
- `POST /api/field-notes` - Create new field note with GPX data
- `GET /api/field-notes/:id` - Get specific field note details
- `GET /api/field-notes/:id/photos` - Get photos associated with a field note
- `GET /api/photos/:id` - Get detailed photo information with EXIF data

## Data Flow

1. **Data Ingestion**: Field notes and photos are stored with comprehensive metadata including GPS coordinates, EXIF data, and GPX tracks
2. **Database Storage**: PostgreSQL database provides permanent data persistence with proper migrations
3. **API Layer**: Express server provides RESTful endpoints for data retrieval and creation with filtering capabilities
4. **Frontend Queries**: React Query manages API calls with caching and background updates
5. **Map Visualization**: GPX data is rendered on Mapbox maps with photo markers showing precise locations
6. **User Interaction**: Search, filter, and navigation interactions update the display in real-time
7. **Admin Interface**: Built-in admin page at `/admin` allows adding new field notes with GPX file upload

## External Dependencies

### Core Technologies
- **Neon Database**: Serverless PostgreSQL hosting for scalable data storage
- **Mapbox GL JS**: Interactive mapping and geospatial visualization
- **Radix UI**: Accessible, unstyled UI primitives for consistent components
- **Tailwind CSS**: Utility-first CSS framework for rapid styling

### Development Tools
- **Drizzle Kit**: Database migration and schema management
- **Vite**: Fast build tool with hot module replacement
- **TypeScript**: Type safety across the entire application stack

## Deployment Strategy

### Build Process
- **Frontend**: Vite builds the React application to static assets in `dist/public`
- **Backend**: esbuild bundles the Express server to `dist/index.js` for production
- **Database**: Drizzle handles schema migrations and database provisioning

### Environment Configuration
- **Development**: Uses Vite dev server with Express API proxy
- **Production**: Serves static frontend assets through Express with API routes
- **Database**: Requires `DATABASE_URL` environment variable for PostgreSQL connection

### Key Features
- **Responsive Design**: Mobile-first approach with responsive grid layouts
- **Performance**: Optimized images, lazy loading, and efficient caching strategies
- **Accessibility**: Full keyboard navigation and screen reader support through Radix UI
- **SEO Ready**: Server-side rendering capabilities for better search engine visibility

The application is designed to be a comprehensive showcase platform for outdoor enthusiasts to document and share their adventures with rich media integration and precise location tracking.