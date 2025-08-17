# Field Notes GPX Showcase Application

## Overview

This is a full-stack web application designed to showcase outdoor field notes with integrated GPX track visualization and photo management. The application serves as a portfolio/showcase platform for outdoor adventures, combining trip documentation with interactive maps and photo galleries.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes

**August 17, 2025 - GPS Photo Marker Fix & UI Improvements:**
- ✓ Fixed GPS coordinate extraction from iPhone photos for accurate map positioning
- ✓ Updated EXIF extraction to properly parse GPS latitude/longitude with field translation
- ✓ Corrected photo marker positioning on maps using real GPS coordinates from EXIF data
- ✓ Enhanced field note detail page with primary Edit button and secondary delete icon
- ✓ Improved auto-upload photo experience with better progress indicators
- ✓ Fixed ProgressBar label warning in photo uploader component

**August 17, 2025 - Left Sidebar Filtering System:**
- ✓ Implemented Carbon Design System left navigation filtering pattern  
- ✓ Added collapsible sidebar with multiple filter categories (Trip Type, Distance, Elevation)
- ✓ Enabled multi-select filtering for trip types using checkboxes
- ✓ Added distance and elevation range filters using radio buttons
- ✓ Implemented active filter count badges and reset functionality
- ✓ Enhanced responsive design with show/hide filter panel
- ✓ Added result count display and improved empty state handling
- ✓ Maintained search highlighting and existing functionality

**August 16, 2025 - Production Photo Upload Performance Optimization:**
- ✓ Implemented parallel EXIF processing with batching (max 3 files concurrently)
- ✓ Added client-side upload timeout handling (15 seconds) with retry logic
- ✓ Optimized server-side EXIF extraction to only download first 64KB for metadata
- ✓ Moved photo EXIF processing to background async tasks to prevent blocking uploads
- ✓ Added comprehensive error handling with detailed failure messages and retry capabilities
- ✓ Enhanced upload reliability with exponential backoff retry strategy (3 attempts)
- ✓ Implemented file validation and memory limits to prevent server overload
- ✓ Added 3-second auto-dismissal for toast notifications with smooth animations

**August 10, 2025 - Search Highlighting & Data Sync:**
- ✓ Implemented search term highlighting using Carbon Design System $support-warning token
- ✓ Enhanced fuzzy search with case-insensitive matching across title, description, and trip type
- ✓ Created data export/import system for production-development synchronization
- ✓ Added comprehensive data sync scripts with merge and replace options
- ✓ Fixed field note type badge capitalization display

**August 10, 2025 - Mobile UI Improvements:**
- ✓ Improved photo lightbox mobile experience by hiding close button on small screens
- ✓ Added CSS media query targeting Carbon Modal footer elements
- ✓ Enhanced mobile usability with top close icon remaining accessible
- ✓ Fixed security vulnerability by removing hardcoded Mapbox token fallback

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
6. **User Interaction**: Search, filter, and navigation interactions update the display in real-time with highlighted search terms
7. **Admin Interface**: Built-in admin page at `/admin` allows adding new field notes with GPX file upload

## Environment Data Synchronization

The application supports data synchronization between development and production environments:

- **Export/Import System**: Scripts to transfer field notes and photo metadata between databases
- **Merge vs Replace**: Options to either merge new data or completely replace existing data
- **Object Storage Separation**: Each environment maintains separate photo storage buckets
- **Usage**: Run `./data-sync.sh export` to export data, transfer the JSON file, then `./data-sync.sh import` to import

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