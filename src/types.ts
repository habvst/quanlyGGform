/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface FormConfigSettings {
  formId: string;
  enableTimeLimit: boolean;
  startTime: string; // YYYY-MM-DDTHH:mm
  endTime: string;   // YYYY-MM-DDTHH:mm
  enableMaxResponses: boolean;
  maxResponses: number;
  enableEmailWhitelist: boolean;
  emailWhitelist: string; // comma-separated emails or domains (e.g., '@gmail.com, example@company.com')
  appsScriptUrl?: string; // Web App URL for deleting/syncing responses with Google Forms directly
  lastUpdated?: string;
  isAcceptingResponses?: boolean;
}

export interface GoogleFormInfo {
  id: string;
  title: string;
  description: string;
  responderUri: string;
  isAcceptingResponses: boolean;
  linkedSheetId?: string | null;
  responsesCount: number;
  questions: Array<{
    id: string;
    title: string;
    type: string;
  }>;
  settings?: FormConfigSettings;
  headers?: string[];
  rawRows?: string[][];
}

export interface FormResponseData {
  responseId: string;
  originalIndex?: number;
  timestamp: string;
  email: string;
  answers: Record<string, string>; // Maps Question Title -> Answer Value
  rowValues?: string[]; // Raw values representing the full spreadsheet row
}

export interface DriveFolder {
  id: string;
  name: string;
  parents?: string[];
}

export interface FormPermission {
  id: string;
  type: string; // 'user', 'group', 'domain', 'anyone'
  role: string; // 'owner', 'writer', 'reader'
  emailAddress?: string;
  displayName?: string;
}

export interface SystemNotification {
  id: string;
  formName: string;
  type: 'success' | 'warning' | 'error' | 'info';
  message: string;
  timestamp: string;
  read: boolean;
}
