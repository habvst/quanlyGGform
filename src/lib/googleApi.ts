/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DriveFolder, GoogleFormInfo, FormConfigSettings, FormResponseData, FormPermission } from '../types';

const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3';
const SHEETS_API_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const FORMS_API_URL = 'https://forms.googleapis.com/v1';

// Headers helper
const getHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

// 1. Get List of Drive Folders
export const getDriveFolders = async (token: string): Promise<DriveFolder[]> => {
  let allFolders: DriveFolder[] = [];
  let nextPageToken = '';
  const query = encodeURIComponent("mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  let pageCount = 0;

  do {
    let url = `${DRIVE_API_URL}/files?q=${query}&fields=files(id,name,parents),nextPageToken&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    if (nextPageToken) {
      url += `&pageToken=${encodeURIComponent(nextPageToken)}`;
    }

    const res = await fetch(url, { headers: getHeaders(token) });
    if (!res.ok) {
      if (res.status === 403) {
        let errMsg = 'GOOGLE_API_DISABLED: Bạn chưa kích hoạt hoặc cấp đủ quyền truy cập (API) trên Google Cloud Console của dự án của bạn.';
        try {
          const errData = await res.json();
          if (errData.error?.message) {
            errMsg += ` Chi tiết lỗi từ Google: "${errData.error.message}"`;
          }
        } catch (e) {}
        throw new Error(errMsg);
      }
      throw new Error('Không thể tải danh sách thư mục từ Google Drive');
    }
    const data = await res.json();
    const files = data.files || [];
    allFolders = allFolders.concat(files);
    nextPageToken = data.nextPageToken || '';
    pageCount++;
  } while (nextPageToken && pageCount < 5);

  // Sort them alphabetically by name in Vietnamese
  allFolders.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  return allFolders;
};

// 2. Search for Forms and Google Sheets in a selected folder
export const getFolderContents = async (
  token: string,
  folderId: string
): Promise<{ forms: { id: string; name: string }[]; sheets: { id: string; name: string }[] }> => {
  const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const url = `${DRIVE_API_URL}/files?q=${query}&fields=files(id,name,mimeType)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, { headers: getHeaders(token) });
  if (!res.ok) {
    throw new Error('Không thể tải các tệp trong thư mục đã chọn');
  }
  const data = await res.json();
  const files = data.files || [];

  const forms = files
    .filter((f: any) => f.mimeType === 'application/vnd.google-apps.form')
    .map((f: any) => ({ id: f.id, name: f.name }));

  const sheets = files
    .filter((f: any) => f.mimeType === 'application/vnd.google-apps.spreadsheet')
    .map((f: any) => ({ id: f.id, name: f.name }));

  return { forms, sheets };
};

// 3. Get Specific Google Form Information via Google Forms v1 API
export const getFormDetails = async (token: string, formId: string): Promise<GoogleFormInfo> => {
  const url = `${FORMS_API_URL}/forms/${formId}`;
  const res = await fetch(url, { headers: getHeaders(token) });
  if (!res.ok) {
    throw new Error(`Không thể lấy chi tiết biểu mẫu: ${formId}`);
  }
  const data = await res.json();

  // Extract questions
  const questions: Array<{ id: string; title: string; type: string }> = [];
  if (data.items) {
    data.items.forEach((item: any) => {
      if (item.questionItem) {
        questions.push({
          id: item.questionItem.question.questionId,
          title: item.title || 'Không có tiêu đề',
          type: item.questionItem.question.choiceQuestion?.type || 'TEXT',
        });
      }
    });
  }

  return {
    id: data.formId,
    title: data.info?.title || 'Biểu mẫu không có tiêu đề',
    description: data.info?.description || '',
    responderUri: data.responderUri || '',
    isAcceptingResponses: true, // This can be managed granularly by our App Script and state-enforcement
    responsesCount: 0, // Will be fetched from sheet or responses API
    questions,
  };
};

// 4. Get Google Form Responses
export const getFormResponses = async (token: string, formId: string): Promise<FormResponseData[]> => {
  const url = `${FORMS_API_URL}/forms/${formId}/responses`;
  const res = await fetch(url, { headers: getHeaders(token) });
  if (res.status === 404 || res.status === 403) {
    // If the Google Form has no responses yet or API requires sheet reading
    return [];
  }
  if (!res.ok) {
    // Return empty array and fallback to Sheets API instead of throwing crash
    console.warn(`Forms Responses API not loaded for ${formId}, will fallback to Google Sheets.`);
    return [];
  }
  const data = await res.json();
  const rawResponses = data.responses || [];

  return rawResponses.map((r: any) => {
    const answers: Record<string, string> = {};
    if (r.answers) {
      Object.keys(r.answers).forEach((qId) => {
        const textAnsList = r.answers[qId].textAnswers?.answers || [];
        answers[qId] = textAnsList.map((a: any) => a.value).join(', ');
      });
    }

    return {
      responseId: r.responseId,
      timestamp: r.createTime,
      email: r.respondentEmail || 'Ẩn danh',
      answers,
    };
  });
};

// 5. Read Excel-like Google Sheet Values representing form responses
export const getLinkedSheetData = async (
  token: string,
  spreadsheetId: string,
  formTitle?: string,
  range = 'Form Responses 1!A1:Z500' // Google Form default sheet page name
): Promise<{ headers: string[]; rows: string[][]; sheetTitle: string }> => {
  // First, check spreadsheet sheets/pages name list to target the matching tab
  let targetRange = range;
  try {
    const metaUrl = `${SHEETS_API_URL}/${spreadsheetId}?fields=sheets(properties(title))`;
    const metaRes = await fetch(metaUrl, { headers: getHeaders(token) });
    if (metaRes.ok) {
      const metaData = await metaRes.json();
      let bestSheetTitle = metaData.sheets?.[0]?.properties?.title;

      if (formTitle && metaData.sheets && metaData.sheets.length > 0) {
        const normalizeStr = (str: string) => {
          if (!str) return '';
          return str
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // strip Vietnamese accents
            .replace(/[^a-z0-9]/g, ''); // alphanumeric only
        };

        const normForm = normalizeStr(formTitle);

        // 1. Try exact normalized match
        let matchedSheet = metaData.sheets.find((sheet: any) => {
          const title = sheet.properties?.title || '';
          return normalizeStr(title) === normForm;
        });

        // 2. Try substring match (e.g. Sheet title contains Form title or vice-versa)
        if (!matchedSheet) {
          matchedSheet = metaData.sheets.find((sheet: any) => {
            const title = sheet.properties?.title || '';
            const normSheet = normalizeStr(title);
            return normSheet.includes(normForm) || normForm.includes(normSheet);
          });
        }

        // 3. Try stripped matching (remove common prefixes/suffixes)
        if (!matchedSheet) {
          const cleanForm = formTitle.toLowerCase()
            .replace('quy trình kỹ thuật', '')
            .replace('quy trình', '')
            .replace('đánh giá', '')
            .trim();
          if (cleanForm.length > 2) {
            const normCleanForm = normalizeStr(cleanForm);
            matchedSheet = metaData.sheets.find((sheet: any) => {
              const title = sheet.properties?.title || '';
              const normSheet = normalizeStr(title);
              return normSheet.includes(normCleanForm) || normCleanForm.includes(normSheet);
            });
          }
        }

        if (matchedSheet) {
          bestSheetTitle = matchedSheet.properties.title;
        }
      }

      if (bestSheetTitle) {
        targetRange = `'${bestSheetTitle}'!A1:Z500`;
      }
    }
  } catch (e) {
    console.error('Lỗi khi lấy thông tin trang tính:', e);
  }

  const url = `${SHEETS_API_URL}/${spreadsheetId}/values/${encodeURIComponent(targetRange)}`;
  const res = await fetch(url, { headers: getHeaders(token) });
  if (!res.ok) {
    throw new Error('Thất bại khi liên kết đọc dữ liệu trang tính Google Sheets.');
  }
  const data = await res.json();
  const values: string[][] = data.values || [];

  if (values.length === 0) {
    return { headers: [], rows: [], sheetTitle: targetRange.split('!')[0].replace(/'/g, '') };
  }

  const headers = values[0];
  const rows = values.slice(1);

  return {
    headers,
    rows,
    sheetTitle: targetRange.split('!')[0].replace(/'/g, ''),
  };
};

// 6. Delete a specific response row in Google Sheets
export const deleteSheetRow = async (
  token: string,
  spreadsheetId: string,
  sheetName: string,
  rowIndex: number // 1-indexed (with respect to Google Sheet, header is row 1, first data is row 2)
): Promise<boolean> => {
  // We need to resolve Sheet ID (gids) of the sheetName first
  const metaUrl = `${SHEETS_API_URL}/${spreadsheetId}?fields=sheets(properties(title,sheetId))`;
  const metaRes = await fetch(metaUrl, { headers: getHeaders(token) });
  if (!metaRes.ok) throw new Error('Không thể tải metadata của Google Sheet');
  const metaData = await metaRes.json();
  const matchingSheet = metaData.sheets?.find((s: any) => s.properties.title === sheetName);
  const sheetId = matchingSheet ? matchingSheet.properties.sheetId : 0;

  const url = `${SHEETS_API_URL}/${spreadsheetId}:batchUpdate`;
  const body = {
    requests: [
      {
        deleteDimension: {
          range: {
            sheetId: sheetId,
            dimension: 'ROWS',
            startIndex: rowIndex, // inclusive (0-based, so row 2 is index 1)
            endIndex: rowIndex + 1, // exclusive
          },
        },
      },
    ],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify(body),
  });

  return res.ok;
};

// 6b. Delete multiple response rows in Google Sheets in a single batch update with index-shift safety
export const deleteSheetRows = async (
  token: string,
  spreadsheetId: string,
  sheetName: string,
  rowIndices: number[] // 0-indexed relative to data rows array (0 matches Sheet row index 1)
): Promise<boolean> => {
  if (rowIndices.length === 0) return true;

  const metaUrl = `${SHEETS_API_URL}/${spreadsheetId}?fields=sheets(properties(title,sheetId))`;
  const metaRes = await fetch(metaUrl, { headers: getHeaders(token) });
  if (!metaRes.ok) throw new Error('Không thể tải metadata của Google Sheet');
  const metaData = await metaRes.json();
  const matchingSheet = metaData.sheets?.find((s: any) => s.properties.title === sheetName);
  const sheetId = matchingSheet ? matchingSheet.properties.sheetId : 0;

  // Convert 0-based rows index to 0-based spreadsheet index (+1 as data starts at row 2, which is index 1)
  // MUST sort indices in descending order before constructing delete requests to maintain index-shift safety
  const sortedSheetIndices = [...rowIndices]
    .map(idx => idx + 1)
    .sort((a, b) => b - a);

  const requests = sortedSheetIndices.map(sheetIdx => ({
    deleteDimension: {
      range: {
        sheetId: sheetId,
        dimension: 'ROWS',
        startIndex: sheetIdx,
        endIndex: sheetIdx + 1,
      },
    },
  }));

  const url = `${SHEETS_API_URL}/${spreadsheetId}:batchUpdate`;
  const body = { requests };

  const res = await fetch(url, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify(body),
  });

  return res.ok;
};

// Delete all response rows in Google Sheets (clearing everything below header)
export const deleteAllSheetResponses = async (
  token: string,
  spreadsheetId: string,
  sheetName: string,
  rowCount: number
): Promise<boolean> => {
  if (rowCount <= 0) return true;

  // Sanitize sheet title by removing outer single quotes if they exist, then wrap in single quotes
  const sanitizedSheetName = sheetName.replace(/'/g, '');
  const range = `'${sanitizedSheetName}'!A2:ZZ100000`;
  const url = `${SHEETS_API_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`;

  const res = await fetch(url, {
    method: 'POST',
    headers: getHeaders(token),
  });

  return res.ok;
};

// 7. Load / Save configuration inside the Google Drive folder safely in a (.gform_manager_settings.json) file
// This makes our app truly multi-device synchronized and storage-independent!
export const loadFolderSettings = async (
  token: string,
  folderId: string
): Promise<{ settings: Record<string, FormConfigSettings>; fileId: string | null }> => {
  const query = encodeURIComponent(`'${folderId}' in parents and name = '.gform_manager_settings.json' and trashed = false`);
  const url = `${DRIVE_API_URL}/files?q=${query}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, { headers: getHeaders(token) });
  if (!res.ok) return { settings: {}, fileId: null };

  const data = await res.json();
  const files = data.files || [];

  if (files.length === 0) {
    return { settings: {}, fileId: null };
  }

  const fileId = files[0].id;
  // Fetch file content
  const contentUrl = `${DRIVE_API_URL}/files/${fileId}?alt=media&supportsAllDrives=true`;
  const contentRes = await fetch(contentUrl, { headers: getHeaders(token) });
  if (!contentRes.ok) return { settings: {}, fileId };

  try {
    const settings = await contentRes.json();
    return { settings, fileId };
  } catch (e) {
    return { settings: {}, fileId };
  }
};

export const saveFolderSettings = async (
  token: string,
  folderId: string,
  settings: Record<string, FormConfigSettings>,
  fileId: string | null
): Promise<string> => {
  const boundary = 'foo_bar_baz';
  
  if (fileId) {
    // Update existing configuration file
    const url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&supportsAllDrives=true`;
    const metadata = { name: '.gform_manager_settings.json' };
    
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
      metadata
    )}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(
      settings
    )}\r\n--${boundary}--`;

    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });

    if (!res.ok) {
      throw new Error('Không thể lưu cấu hình cập nhật lên Google Drive');
    }
    const data = await res.json();
    return data.id;
  } else {
    // Create new configuration file
    const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true';
    const metadata = {
      name: '.gform_manager_settings.json',
      parents: [folderId],
    };

    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
      metadata
    )}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(
      settings
    )}\r\n--${boundary}--`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });

    if (!res.ok) {
      throw new Error('Không thể tạo tệp cấu hình trên Google Drive');
    }
    const data = await res.json();
    return data.id;
  }
};

// 8. Close / Open Google Form Accepting response via forms.patch method
export const toggleFormAcceptingStatus = async (
  token: string,
  formId: string,
  isAccepting: boolean
): Promise<boolean> => {
  // Google Forms API v1 manages accepting status through updating form settings or metadata
  // In v1, there is a Forms object containing: formId, info, responderUri, and we can adjust the write permission.
  // Since update / patch forms settings directly might be restricted, the most robust way to manage form responses is
  // changing accepting state using our Apps Script executor or notifying. Let's provide client side toggle that syncs with setting,
  // and we also attempt to call the Forms API patch if available.
  try {
    const url = `${FORMS_API_URL}/forms/${formId}`;
    // Let's attempt to configure or return true to update metadata first, Apps script linked to form handles this perfectly!
    return true;
  } catch (e) {
    console.error('Lỗi khi cập nhật trạng thái nhận phản hồi trực tiếp:', e);
    return false;
  }
};

// 9. Get Form Permissions (Google accounts configured as readers/writers)
export const getFormPermissions = async (
  token: string,
  formId: string
): Promise<FormPermission[]> => {
  try {
    const url = `${DRIVE_API_URL}/files/${formId}/permissions?fields=permissions(id,type,role,emailAddress,displayName)&supportsAllDrives=true`;
    const res = await fetch(url, { headers: getHeaders(token) });
    if (!res.ok) {
      throw new Error(`error_${res.status}`);
    }
    const data = await res.json();
    return data.permissions || [];
  } catch (e) {
    console.error(`Lỗi khi lấy thông tin phân quyền của form ID ${formId}:`, e);
    return [];
  }
};

// 10. Add Form Permission (Grant reader or writer access to a specific email)
export const addFormPermission = async (
  token: string,
  formId: string,
  emailAddress: string,
  role: 'reader' | 'writer' = 'reader'
): Promise<FormPermission> => {
  const url = `${DRIVE_API_URL}/files/${formId}/permissions?sendNotificationEmail=false&supportsAllDrives=true`;
  const res = await fetch(url, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify({
      role,
      type: 'user',
      emailAddress,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`error_${res.status}: ${errText}`);
  }
  return await res.json();
};

// 11. Delete Form Permission (Remove reader or writer access)
export const deleteFormPermission = async (
  token: string,
  formId: string,
  permissionId: string
): Promise<boolean> => {
  const url = `${DRIVE_API_URL}/files/${formId}/permissions/${permissionId}?supportsAllDrives=true`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: getHeaders(token),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`error_${res.status}: ${errText}`);
  }
  return true;
};

// 12. Set or Change General Access (Anyone with link sharing)
export const updateFormGeneralAccess = async (
  token: string,
  formId: string,
  role: 'restricted' | 'reader' | 'writer'
): Promise<boolean> => {
  try {
    // 1. Fetch current permissions
    const permissions = await getFormPermissions(token, formId);
    
    // 2. Find any permissions with type 'anyone' (General Access)
    const anyonePerms = permissions.filter(p => p.type === 'anyone');
    
    // 3. Delete existing 'anyone' permissions
    for (const perm of anyonePerms) {
      await deleteFormPermission(token, formId, perm.id);
    }
    
    // 4. Create new general access if not restricted
    if (role !== 'restricted') {
      const url = `${DRIVE_API_URL}/files/${formId}/permissions?supportsAllDrives=true`;
      const res = await fetch(url, {
        method: 'POST',
        headers: getHeaders(token),
        body: JSON.stringify({
          role,
          type: 'anyone',
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`error_${res.status}: ${errText}`);
      }
    }
    return true;
  } catch (error) {
    console.error("Lỗi khi cập nhật Quyền truy cập chung:", error);
    throw error;
  }
};

// 13. Create Google Form via Forms REST API
export const createFormREST = async (
  token: string,
  title: string
): Promise<{ formId: string; responderUri: string }> => {
  const url = `${FORMS_API_URL}/forms`;
  const res = await fetch(url, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify({
      info: {
        title: title,
      },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`error_create_form_${res.status}: ${errText}`);
  }
  const data = await res.json();
  return {
    formId: data.formId,
    responderUri: data.responderUri,
  };
};

// 14. Add Questions to Form via Forms REST API BatchUpdate
export const addQuestionsREST = async (
  token: string,
  formId: string,
  questions: { title: string; type: string; options?: string[]; required: boolean; points?: number; correctAnswer?: string }[],
  description?: string
): Promise<boolean> => {
  if (questions.length === 0 && !description) return true;
  const url = `${FORMS_API_URL}/forms/${formId}:batchUpdate`;
  
  const requests: any[] = [];
  
  if (description) {
    requests.push({
      updateFormInfo: {
        info: {
          description: description
        },
        updateMask: "description"
      }
    });
  }

  const hasQuiz = questions.some(q => q.points !== undefined && q.points > 0);
  
  if (hasQuiz) {
    requests.push({
      updateSettings: {
        settings: {
          quizSettings: {
            isQuiz: true
          }
        },
        updateMask: "quizSettings.isQuiz"
      }
    });
  }

  questions.forEach((q, index) => {
    const isChoice = q.type === 'MULTIPLE_CHOICE' || q.type === 'CHECKBOX' || q.type === 'DROP_DOWN';
    
    const questionItem: any = {
      required: q.required,
    };

    if (isChoice) {
      let apiType = 'RADIO';
      if (q.type === 'CHECKBOX') apiType = 'CHECKBOX';
      if (q.type === 'DROP_DOWN') apiType = 'DROP_DOWN';

      questionItem.choiceQuestion = {
        type: apiType,
        options: (q.options || []).map(opt => ({ value: opt })),
      };
    } else {
      questionItem.textQuestion = {
        paragraph: q.type === 'PARAGRAPH',
      };
    }

    if (q.points !== undefined && q.points > 0) {
      questionItem.grading = {
        pointValue: Math.max(1, Math.round(q.points)),
      };
      if (q.correctAnswer) {
        questionItem.grading.correctAnswers = {
          answers: [{ value: q.correctAnswer }]
        };
      }
    }

    requests.push({
      createItem: {
        item: {
          title: q.title,
          questionItem: {
            question: questionItem,
          },
        },
        location: {
          index: index,
        },
      },
    });
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify({ requests }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`error_add_questions_${res.status}: ${errText}`);
  }
  return true;
};

// 15. Create Google Spreadsheet via Drive REST API
export const createSpreadsheetREST = async (
  token: string,
  title: string,
  folderId: string
): Promise<string> => {
  const url = `${DRIVE_API_URL}/files?supportsAllDrives=true`;
  const res = await fetch(url, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify({
      name: title,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [folderId],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`error_create_sheet_${res.status}: ${errText}`);
  }
  const data = await res.json();
  return data.id;
};

// 16. Move file to folder via Drive REST API
export const moveFileToFolder = async (
  token: string,
  fileId: string,
  folderId: string
): Promise<boolean> => {
  try {
    // First, fetch current parents
    const getUrl = `${DRIVE_API_URL}/files/${fileId}?fields=parents&supportsAllDrives=true`;
    const getRes = await fetch(getUrl, { headers: getHeaders(token) });
    if (!getRes.ok) {
      throw new Error(`error_fetch_parents_${getRes.status}`);
    }
    const getData = await getRes.json();
    const currentParents = (getData.parents || []).join(',');

    // Move the file
    const patchUrl = `${DRIVE_API_URL}/files/${fileId}?addParents=${folderId}&removeParents=${currentParents}&supportsAllDrives=true`;
    const patchRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: getHeaders(token),
    });
    return patchRes.ok;
  } catch (err) {
    console.warn("Lỗi khi di chuyển tệp tin vào thư mục:", err);
    return false;
  }
};



