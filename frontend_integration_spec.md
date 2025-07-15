# Frontend Integration Specification: Custom Prompt Templates

## Overview

This document provides the complete specification for integrating the custom prompt template system into the frontend. The system allows users to upload example meeting minutes PDFs and automatically generate custom prompts for meeting transcript analysis.

## Backend Components Overview

### 1. Database Schema (DynamoDB)

**Table: PromptTemplates**

- Primary Key: `templateId` (String) + `createdAt` (String)
- Global Secondary Index: `StatusIndex` - `status` (String) + `createdAt` (String)

**Item Structure:**

```typescript
interface PromptTemplate {
  templateId: string; // UUID
  createdAt: string; // ISO timestamp
  title: string; // User-provided title
  status: "processing" | "available" | "failed";
  sourceFile: string; // S3 key of uploaded PDF
  customPrompt?: string; // Generated custom prompt
  errorMessage?: string; // Error details if status is 'failed'
  updatedAt: string; // ISO timestamp
}
```

### 2. API Endpoints

**Base URL:** `{API_GATEWAY_URL}/prompt-templates`

## Frontend Implementation Requirements

### 1. List Available Prompt Templates

**Endpoint:** `GET /prompt-templates`

**Query Parameters:**

- `includeProcessing` (optional): `true` | `false` (default: `false`)
  - `false`: Only return templates with status 'available'
  - `true`: Return all templates including 'processing' and 'failed'

**Response:**

```typescript
interface ListTemplatesResponse {
  templates: PromptTemplate[];
  count: number;
}
```

**Frontend Usage:**

```typescript
// Fetch only available templates for selection
const availableTemplates = await fetch(`${API_URL}/prompt-templates`);

// Fetch all templates including processing ones for status display
const allTemplates = await fetch(
  `${API_URL}/prompt-templates?includeProcessing=true`
);
```

### 2. Upload Prompt Template Example

**Endpoint:** `POST /prompt-templates/upload`

**Request Body:**

```typescript
interface UploadRequest {
  title: string; // Max 100 characters, non-empty
}
```

**Response:**

```typescript
interface UploadResponse {
  templateId: string; // UUID for the new template
  title: string; // Sanitized title
  uploadUrl: string; // Presigned S3 URL for PDF upload
  objectKey: string; // S3 key where file will be stored
  expiresIn: number; // URL expiration time in seconds (3600)
}
```

**Frontend Implementation:**

```typescript
async function createPromptTemplate(title: string): Promise<UploadResponse> {
  const response = await fetch(`${API_URL}/prompt-templates/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title }),
  });

  if (!response.ok) {
    throw new Error("Failed to create upload URL");
  }

  return response.json();
}

async function uploadPDF(uploadUrl: string, pdfFile: File): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/pdf",
    },
    body: pdfFile,
  });

  if (!response.ok) {
    throw new Error("Failed to upload PDF");
  }
}
```

### 3. Meeting Upload Integration

When uploading meeting recordings and agendas, include the prompt template selection:

**Existing Upload API Enhancement:**
The existing upload API should be modified to accept an optional `customPromptTemplateId` parameter.

**Updated Request Body:**

```typescript
interface MeetingUploadRequest {
  // ... existing fields ...
  customPromptTemplateId?: string; // Optional template ID
}
```

This parameter will be passed through the Step Functions workflow to the transcript processing Lambda.

## UI Components Needed

### 1. Prompt Template Creation Dialog

**Location:** Next to the upload button (as specified)

**Components:**

- **Trigger Button:** "Create Custom Template" or similar
- **Modal/Dialog:**
  - Title input field (max 100 characters)
  - PDF file upload area
  - Preview of filename format: `{templateId}_{sanitized_title}.pdf`
  - Submit button
  - Progress indicator
  - Error handling display

**Behavior:**

1. User clicks "Create Custom Template"
2. Dialog opens with title input and file picker
3. User enters title and selects PDF file
4. Frontend calls upload API to get presigned URL
5. Frontend uploads PDF directly to S3 using presigned URL
6. Success message shows "Template is being processed..."
7. Dialog closes

### 2. Prompt Template Selection

**Location:** In the meeting upload form

**Components:**

- **Dropdown/Select:** List of available prompt templates
- **Default Option:** "Standard Template" (uses built-in prompt)
- **Template Options:** Show title and creation date
- **Status Indicators:**
  - Available templates: Normal display
  - Processing templates: Grayed out with "Processing..." text
  - Failed templates: Not shown or marked as unavailable

**Data Structure:**

```typescript
interface TemplateOption {
  value: string; // templateId or 'default'
  label: string; // Template title
  status: "available" | "processing" | "failed";
  createdAt: string; // For sorting
}
```

### 3. Template Management (Optional Enhancement)

**Location:** Settings or admin section

**Features:**

- List all templates with status
- View template details
- Delete templates
- Rename templates
- View error messages for failed templates

## State Management

### Template List State

```typescript
interface TemplateState {
  templates: PromptTemplate[];
  loading: boolean;
  error: string | null;
  lastRefresh: Date;
}
```

### Upload State

```typescript
interface UploadState {
  isUploading: boolean;
  uploadProgress: number;
  currentStep: "creating" | "uploading" | "processing" | "complete" | "error";
  error: string | null;
  templateId?: string;
}
```

## Error Handling

### API Error Responses

```typescript
interface ErrorResponse {
  error: string;
  message: string;
}
```

### Common Error Scenarios:

1. **Title Validation:** Empty or > 100 characters
2. **File Type:** Not a PDF file
3. **File Size:** Too large (implement reasonable limit)
4. **Network Errors:** Upload failures, API timeouts
5. **Processing Errors:** PDF text extraction failures, AI prompt generation failures

### Error Display:

- Toast notifications for temporary errors
- Inline validation for form errors
- Status indicators for long-running processes

## Data Flow

### Template Creation Flow:

1. User enters title and selects PDF
2. Frontend validates input
3. Frontend calls `/prompt-templates/upload` API
4. Frontend uploads PDF to S3 using presigned URL
5. S3 trigger automatically starts processing
6. Backend extracts text and generates custom prompt
7. Template status updates in database
8. Frontend polls for status updates (or use WebSockets if available)

### Meeting Processing Flow:

1. User uploads meeting with selected template
2. Step Functions workflow includes `customPromptTemplateId`
3. Process transcript Lambda checks for custom template
4. If found and available, uses custom prompt
5. If not found/available, falls back to default prompt
6. Meeting analysis proceeds normally

## Implementation Notes

### Authentication

All API calls require Cognito JWT token in Authorization header:

```
Authorization: Bearer {jwt_token}
```

### File Upload Constraints

- Maximum file size: 10MB (recommended)
- File type: PDF only
- Filename format: Automatically generated as `{templateId}_{sanitized_title}.pdf`

### Polling Strategy

For checking template processing status:

```typescript
async function pollTemplateStatus(templateId: string): Promise<PromptTemplate> {
  const maxAttempts = 30; // 5 minutes max
  const interval = 10000; // 10 seconds

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const templates = await fetchTemplates(true); // Include processing
    const template = templates.find((t) => t.templateId === templateId);

    if (template && template.status !== "processing") {
      return template;
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error("Template processing timeout");
}
```

### Security Considerations

- File uploads go directly to S3 using presigned URLs
- Template access is organization-wide (no user-level restrictions)
- PDF processing is sandboxed in Lambda environment
- Generated prompts are validated for required placeholders

### Performance Considerations

- Template list should be cached and refreshed periodically
- Consider pagination if many templates exist
- PDF upload progress should be shown to user
- Failed uploads should allow retry

## Testing Checklist

### Unit Tests

- [ ] Template creation API calls
- [ ] PDF upload functionality
- [ ] Template selection component
- [ ] Error handling scenarios

### Integration Tests

- [ ] End-to-end template creation flow
- [ ] Meeting upload with custom template
- [ ] Template status polling
- [ ] Error recovery scenarios

### User Experience Tests

- [ ] Template creation is intuitive
- [ ] Processing status is clear
- [ ] Error messages are helpful
- [ ] Template selection works in meeting upload
- [ ] Performance is acceptable for PDF uploads

This specification provides all the necessary information for frontend implementation of the custom prompt template system.
