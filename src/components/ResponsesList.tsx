/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Trash2, Search, ArrowLeft, RefreshCw, FileSpreadsheet, 
  Download, AlertTriangle, ArrowUpDown, Calendar, Mail, CheckCircle, Info,
  User, Award, Clock
} from 'lucide-react';
import { FormResponseData, GoogleFormInfo } from '../types';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';

const safeParseDate = (dateStr: string): Date | null => {
  if (!dateStr) return null;
  
  // Try DD/MM/YYYY HH:mm:ss or DD/MM/YYYY (Vietnamese / standard format) first to prevent browser from misinterpreting as MM/DD/YYYY
  const parts = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (parts) {
    const day = parseInt(parts[1], 10);
    const month = parseInt(parts[2], 10) - 1; // 0-based month
    const year = parseInt(parts[3], 10);
    const hour = parts[4] ? parseInt(parts[4], 10) : 0;
    const minute = parts[5] ? parseInt(parts[5], 10) : 0;
    const second = parts[6] ? parseInt(parts[6], 10) : 0;
    const parsedDate = new Date(year, month, day, hour, minute, second);
    if (!isNaN(parsedDate.getTime())) return parsedDate;
  }

  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;
  
  return null;
};

const formatDisplayDate = (dateStr: string): string => {
  const d = safeParseDate(dateStr);
  if (d) {
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }
  return dateStr; // Fallback to raw value
};

const normalizeEmailOrName = (str: string): string => {
  if (!str) return '';
  const trimmed = str.trim();
  if (trimmed.includes('@')) {
    return trimmed.toLowerCase();
  }
  // It's a name, capitalize first letter of each word (Title Case)
  return trimmed
    .split(/\s+/)
    .map(word => {
      if (!word) return '';
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
};

const removeVietnameseTones = (str: string): string => {
  if (!str) return '';
  let result = str;
  result = result.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
  result = result.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "A");
  result = result.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
  result = result.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, "E");
  result = result.replace(/ì|í|ị|ỉ|ĩ/g, "i");
  result = result.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, "I");
  result = result.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
  result = result.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "O");
  result = result.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
  result = result.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "U");
  result = result.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
  result = result.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, "Y");
  result = result.replace(/đ/g, "d");
  result = result.replace(/Đ/g, "D");
  
  // Normalize decomposing Unicode forms to handle composite characters
  try {
    result = result.normalize('NFD').replace(/[\u0300-\u036f]/g, "");
  } catch (e) {
    // Fallback if normalize is not supported
  }
  return result;
};

interface ResponsesListProps {
  form: GoogleFormInfo;
  responses: FormResponseData[];
  headers: string[];
  rawRows: string[][];
  onBack: () => void;
  onRefresh: () => void;
  onDeleteResponse: (responseId: string, email: string, timestamp: string, rowIndex: number) => Promise<void>;
  onDeleteMultipleResponses?: (selectedItems: Array<{ responseId: string; email: string; timestamp: string; rowIndex: number }>) => Promise<void>;
  isDeleting: boolean;
  onDeleteAllResponses: () => Promise<void>;
  isDeletingAll: boolean;
}

export default function ResponsesList({
  form,
  responses,
  headers,
  rawRows,
  onBack,
  onRefresh,
  onDeleteResponse,
  onDeleteMultipleResponses,
  isDeleting,
  onDeleteAllResponses,
  isDeletingAll
}: ResponsesListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterEmail, setFilterEmail] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [viewMode, setViewMode] = useState<'simple' | 'full'>('simple');

  const defaultHeaders = [
    'Dấu thời gian',
    'Điểm số',
    'Người đánh giá',
    'Họ và tên người được đánh giá',
    'Thời gian đánh giá :'
  ];

  const getTargetIndices = (cols: string[]) => {
    const lowercaseHeaders = cols.map(h => h.toLowerCase().trim());

    // 1. Find 'Điểm số' (Score)
    let scoreIdx = lowercaseHeaders.findIndex(h => h === 'điểm số' || h.includes('điểm số') || h === 'điểm' || h.includes('score'));
    if (scoreIdx === -1) scoreIdx = 1; // Default fallback to column 1

    // 2. Find 'Người đánh giá' (Evaluator)
    let evaluatorIdx = lowercaseHeaders.findIndex(h => 
      (h.includes('người đánh giá') || h.includes('giám sát') || h === 'người chấm') && !h.includes('được đánh giá')
    );
    if (evaluatorIdx === -1) {
      evaluatorIdx = lowercaseHeaders.findIndex(h => h.includes('người đánh giá') || h === 'người đánh giá');
    }
    if (evaluatorIdx === -1) evaluatorIdx = 2; // Default fallback to column 2

    // 3. Find 'Họ và tên người được đánh giá' (Evaluated Person)
    let evaluatedIdx = lowercaseHeaders.findIndex(h => 
      h.includes('người được đánh giá') || h.includes('nhân viên được') || h.includes('họ và tên') || h.includes('họ tên')
    );
    if (evaluatedIdx === -1) {
      evaluatedIdx = lowercaseHeaders.findIndex(h => h.includes('tên') && h !== 'người đánh giá' && !h.includes('người đánh giá'));
    }
    if (evaluatedIdx === -1) evaluatedIdx = 3; // Default fallback to column 3

    // 4. Find 'Dấu thời gian' (Submission Timestamp) - MUST exclude 'thời gian thực hiện' or 'thời gian đánh giá'
    let timestampIdx = lowercaseHeaders.findIndex(h => 
      h.includes('dấu thời gian') || h.includes('timestamp')
    );
    if (timestampIdx === -1) timestampIdx = 0; // Default fallback to column 0 (Google Form default)

    // 5. Find 'Thời gian đánh giá :' (Evaluation Time) - MUST exclude 'dấu thời gian' or 'timestamp'
    let evalTimeIdx = lowercaseHeaders.findIndex(h => 
      (h.includes('thời gian đánh giá') || h.includes('ngày đánh giá') || h.includes('thời gian thực hiện')) ||
      (h.includes('thời gian') && !h.includes('dấu') && !h.includes('timestamp')) || 
      (h === 'ngày' || h === 'date')
    );
    if (evalTimeIdx === -1) {
      // Look for a column containing evaluation date/time that isn't the timestamp column
      evalTimeIdx = lowercaseHeaders.findIndex((h, idx) => idx !== timestampIdx && (h.includes('ngày') || h.includes('thời gian') || h.includes('time') || h.includes('date')));
    }
    if (evalTimeIdx === -1) {
      // Fallback
      evalTimeIdx = lowercaseHeaders.length > 4 ? 4 : (timestampIdx !== 0 ? 0 : 4);
    }

    return { scoreIdx, evaluatorIdx, evaluatedIdx, evalTimeIdx, timestampIdx };
  };

  const { scoreIdx, evaluatorIdx, evaluatedIdx, evalTimeIdx, timestampIdx } = getTargetIndices(headers && headers.length > 0 ? headers : [
    'Dấu thời gian',
    'Điểm số',
    'Người đánh giá',
    'Họ và tên người được đánh giá',
    'Thời gian đánh giá :',
    'Khoa - Bộ phận'
  ]);

  const focusedCols = [
    { key: 'timestamp', title: headers?.[timestampIdx] || 'Dấu thời gian', index: timestampIdx },
    { key: 'score', title: headers?.[scoreIdx] || 'Điểm số', index: scoreIdx },
    { key: 'evaluator', title: headers?.[evaluatorIdx] || 'Người đánh giá', index: evaluatorIdx },
    { key: 'evaluated', title: headers?.[evaluatedIdx] || 'Họ và tên người được đánh giá', index: evaluatedIdx },
    { key: 'evalTime', title: headers?.[evalTimeIdx] || 'Thời gian đánh giá :', index: evalTimeIdx }
  ];

  const getRowMainDetails = (row: string[] | undefined, cols: string[], timestamp: string, email: string) => {
    if (!row || !cols) {
      return { name: email || 'Ẩn danh', date: timestamp, dept: '-' };
    }
    const lowercaseHeaders = cols.map(h => h.toLowerCase().trim());
    
    // Find name index (avoiding procedure or form headers)
    let nameIdx = lowercaseHeaders.findIndex(h => {
      const isNameLabel = h.includes('họ và tên') || h.includes('họ tên') || 
                          h.includes('người được đánh giá') || h.includes('người đánh giá') ||
                          h === 'tên' || h.endsWith(' tên') || h.includes('nhân viên');
      const containsProcedure = h.includes('quy trình') || h.includes('procedure') || h.includes('form') || h.includes('bài');
      return isNameLabel && !containsProcedure;
    });
    
    if (nameIdx === -1) {
      nameIdx = lowercaseHeaders.findIndex(h => {
        const isNameLabel = h.includes('tên') || h.includes('name');
        const containsProcedure = h.includes('quy trình') || h.includes('procedure') || h.includes('form') || h.includes('bài');
        return isNameLabel && !containsProcedure;
      });
    }
    
    // Find date index
    let dateIdx = lowercaseHeaders.findIndex(h => 
      h.includes('thời gian đánh giá') || h.includes('ngày đánh giá') || 
      (h.includes('thời gian') && h.includes('đánh giá')) ||
      h === 'ngày' || h === 'date'
    );
    if (dateIdx === -1) {
      dateIdx = lowercaseHeaders.findIndex(h => h.includes('dấu thời gian') || h.includes('timestamp'));
    }

    // Find department index
    let deptIdx = lowercaseHeaders.findIndex(h => 
      h.includes('khoa - bộ phận') || h.includes('khoa phòng') || 
      h.includes('bộ phận') || h.includes('phòng ban') || h.includes('chuyên khoa') ||
      h === 'khoa' || h === 'bộ phận' || h.includes('đơn vị')
    );

    const name = nameIdx !== -1 && row[nameIdx] ? row[nameIdx] : (email !== 'Ẩn danh' ? email : '');
    const rawDate = dateIdx !== -1 && row[dateIdx] ? row[dateIdx] : timestamp;
    const dept = deptIdx !== -1 && row[deptIdx] ? row[deptIdx] : '';

    let fallbackName = name;
    if (!fallbackName) {
      for (let c = 1; c < row.length; c++) {
        const val = row[c]?.trim();
        if (val && !val.includes('@') && isNaN(Number(val)) && val.length > 2 && !val.includes('/') && !val.includes(':')) {
          fallbackName = val;
          break;
        }
      }
    }

    return {
      name: normalizeEmailOrName(fallbackName || 'Ẩn danh'),
      date: rawDate,
      dept: dept || '-'
    };
  };

  // Filter & Sort
  const filteredResponses = responses.filter((item) => {
    const rawSearch = searchTerm.trim();
    if (!rawSearch) {
      const matchesEmail = filterEmail ? item.email.toLowerCase().includes(filterEmail.toLowerCase()) : true;
      return matchesEmail;
    }

    // Split search terms by common delimiters like semicolon, comma, plus sign, or |
    const terms = rawSearch
      .split(/[;,+|]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    if (terms.length === 0) {
      const matchesEmail = filterEmail ? item.email.toLowerCase().includes(filterEmail.toLowerCase()) : true;
      return matchesEmail;
    }

    // Include all row cells and key fields (email, timestamp) as searchable pool
    const valuesToSearch = [
      ...(item.rowValues || Object.values(item.answers)),
      item.email,
      item.timestamp
    ].map((v) => (v || '').toString().toLowerCase());

    // EVERY term from split must match at least one element in the searchable values
    const matchesSearch = terms.every((term) => {
      return valuesToSearch.some((val) => val.includes(term));
    });

    const matchesEmail = filterEmail ? item.email.toLowerCase().includes(filterEmail.toLowerCase()) : true;
    
    return matchesSearch && matchesEmail;
  }).sort((a, b) => {
    const rawValA = a.rowValues?.[evalTimeIdx] || a.timestamp;
    const rawValB = b.rowValues?.[evalTimeIdx] || b.timestamp;
    const dateA = safeParseDate(rawValA);
    const dateB = safeParseDate(rawValB);
    const timeA = dateA ? dateA.getTime() : 0;
    const timeB = dateB ? dateB.getTime() : 0;
    
    if (timeA && timeB) {
      return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
    }
    return sortOrder === 'desc' 
      ? rawValB.localeCompare(rawValA) 
      : rawValA.localeCompare(rawValB);
  });
  
  // Custom Confirmation Dialog State
  const [showConfirm, setShowConfirm] = useState(false);
  const [showAllClearConfirm, setShowAllClearConfirm] = useState(false);
  const [selectedToDelete, setSelectedToDelete] = useState<{
    id: string;
    email: string;
    timestamp: string;
    rowIndex: number;
  } | null>(null);

  // Selection States for multi-delete
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  const handleToggleSelectAll = () => {
    const allFilteredIds = filteredResponses.map(r => r.responseId);
    const allSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds(prev => prev.filter(id => !allFilteredIds.includes(id)));
    } else {
      setSelectedIds(prev => Array.from(new Set([...prev, ...allFilteredIds])));
    }
  };

  const handleToggleSelectItem = (responseId: string) => {
    setSelectedIds(prev => 
      prev.includes(responseId) 
        ? prev.filter(id => id !== responseId) 
        : [...prev, responseId]
    );
  };

  // Memoized selection list with details resolved
  const selectedDetailsToBulkDelete = React.useMemo(() => {
    return filteredResponses
      .filter(r => selectedIds.includes(r.responseId))
      .map(r => {
        const actualRowIdx = r.originalIndex !== undefined 
          ? r.originalIndex 
          : rawRows.findIndex(
              (row) => row[0] === r.timestamp && (row[1] || 'Ẩn danh') === r.email
            );

        const rowDetails = getRowMainDetails(r.rowValues, headers, r.timestamp, r.email);
        
        return {
          responseId: r.responseId,
          email: r.email,
          timestamp: r.timestamp,
          rowIndex: actualRowIdx,
          name: rowDetails.name,
          date: rowDetails.date,
          dept: rowDetails.dept
        };
      });
  }, [selectedIds, filteredResponses, rawRows, headers]);

  const handleConfirmBulkDelete = async () => {
    if (onDeleteMultipleResponses && selectedDetailsToBulkDelete.length > 0) {
      await onDeleteMultipleResponses(selectedDetailsToBulkDelete.map(item => ({
        responseId: item.responseId,
        email: item.email,
        timestamp: item.timestamp,
        rowIndex: item.rowIndex
      })));
      setSelectedIds([]);
      setShowBulkDeleteConfirm(false);
    }
  };

  // Unique email/sender list for filtering (properly deduplicated case-insensitively and formatted in proper title case!)
  const uniqueEmails = React.useMemo(() => {
    const emailMap = new Map<string, string>();
    responses.forEach((r) => {
      if (r.email && r.email !== 'Ẩn danh') {
        const normalized = normalizeEmailOrName(r.email);
        const lowercaseKey = normalized.toLowerCase();
        if (!emailMap.has(lowercaseKey)) {
          emailMap.set(lowercaseKey, normalized);
        }
      }
    });
    return Array.from(emailMap.values()).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [responses]);

  const handleOpenConfirm = (id: string, email: string, timestamp: string, rowIndex: number) => {
    setSelectedToDelete({ id, email, timestamp, rowIndex });
    setShowConfirm(true);
  };

  const handleConfirmDelete = async () => {
    if (selectedToDelete) {
      await onDeleteResponse(
        selectedToDelete.id,
        selectedToDelete.email,
        selectedToDelete.timestamp,
        selectedToDelete.rowIndex
      );
      setShowConfirm(false);
      setSelectedToDelete(null);
    }
  };

  const handleConfirmClearAll = async () => {
    await onDeleteAllResponses();
    setShowAllClearConfirm(false);
  };

  // 3. Export PDF Report function using jsPDF
  const handleExportPDF = () => {
    const doc = new jsPDF({
      orientation: 'p',
      unit: 'mm',
      format: 'a4',
    });

    // Support UTF-8 Unicode characters via dynamic line drawing & clean structure
    // Since jsPDF default font doesn't natively render complex Vietnamese diacritics beautifully on default courier, 
    // we set standard Helvetica and write standard formatted lists with a clean tabular visual.
    
    // Header Title
    doc.setFillColor(30, 41, 59); // Slate-800
    doc.rect(0, 0, 210, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(removeVietnameseTones('BÁO CÁO KẾT QUẢ PHẢN HỒI BIỂU MẪU'), 15, 17);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(226, 232, 240); // Slate-200
    doc.text(removeVietnameseTones(`Biểu mẫu: ${form.title.toUpperCase()}`), 15, 24);
    doc.text(removeVietnameseTones(`Tổng số phản hồi hiện có: ${responses.length} | Ngày xuất: ${new Date().toLocaleDateString('vi-VN')}`), 15, 30);

    // Metadata
    doc.setFillColor(248, 250, 252); // Slate-50
    doc.rect(15, 48, 180, 24, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.rect(15, 48, 180, 24);
    
    doc.setTextColor(51, 65, 85);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(removeVietnameseTones('CÀI ĐẶT QUY TẮC HIỂN THỊ:'), 20, 54);
    
    doc.setFont('helvetica', 'normal');
    doc.text(removeVietnameseTones(`- Giới hạn thời gian: ${form.settings?.enableTimeLimit ? 'BẬT' : 'TẮT'}`), 20, 60);
    doc.text(removeVietnameseTones(`- Giới hạn lượt: ${form.settings?.enableMaxResponses ? `BẬT (${form.settings.maxResponses})` : 'TẮT'}`), 20, 66);
    doc.text(removeVietnameseTones(`- Kiểm duyệt email whitelist: ${form.settings?.enableEmailWhitelist ? 'BẬT' : 'TẮT'}`), 110, 60);

    // List out responses
    let yPos = 85;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text(removeVietnameseTones('DANH SÁCH CÂU TRẢ LỜI CHI TIẾT'), 15, 80);

    filteredResponses.forEach((res, idx) => {
      // Check for page overflow
      if (yPos > 270) {
        doc.addPage();
        yPos = 20;
      }

      // Border and background card for each response
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(241, 245, 249);
      doc.rect(15, yPos - 5, 180, 32, 'DF');

      doc.setFillColor(226, 232, 240);
      doc.rect(15, yPos - 5, 4, 32, 'F');

      // Index and Email
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(removeVietnameseTones(`#${idx + 1}. Người gửi: ${res.email}`), 23, yPos + 1);
      
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(removeVietnameseTones(`Thời gian: ${new Date(res.timestamp).toLocaleString('vi-VN')}`), 125, yPos + 1);

      // Render answers questions (up to 3 most important for layout safety in PDF)
      let ansY = yPos + 7;
      let count = 0;
      Object.keys(res.answers).forEach((qTitle) => {
        if (count < 3) {
          doc.setTextColor(71, 85, 105);
          doc.setFont('helvetica', 'bold');
          const cleanQ = qTitle.length > 50 ? qTitle.substring(0, 50) + '...' : qTitle;
          doc.text(removeVietnameseTones(`- ${cleanQ}:`), 23, ansY);
          
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(51, 65, 85);
          const val = res.answers[qTitle] || '';
          const cleanV = val.length > 60 ? val.substring(0, 60) + '...' : val;
          doc.text(removeVietnameseTones(`  ${cleanV}`), 25, ansY + 4);
          
          ansY += 7;
          count++;
        }
      });

      yPos += 36;
    });

    // Save report
    const pdfFileName = removeVietnameseTones(`Bao_cao_GoogleForm_${form.id.substring(0, 6)}_${new Date().toISOString().slice(0, 10)}.pdf`).replace(/\s+/g, '_');
    doc.save(pdfFileName);
  };

  const handleExportExcel = () => {
    // Collect headers from Google Sheet. Fallback to defaultHeaders if not provided
    const sheetHeaders = ['STT', ...(headers || [])];
    
    // Transform filtered responses into structured rows mirroring spreadsheet columns
    const sheetRows = filteredResponses.map((res, idx) => {
      if (res.rowValues && res.rowValues.length > 0) {
        return [idx + 1, ...res.rowValues];
      } else {
        // Fallback: Construct array based on headers and answers
        return [
          idx + 1,
          ...(headers || []).map((header, hIdx) => {
            if (hIdx === timestampIdx) return res.timestamp;
            if (header === 'Email' || header === 'Người gửi' || header === 'Username') return res.email;
            return res.answers[header] || '';
          })
        ];
      }
    });

    const data = [sheetHeaders, ...sheetRows];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(data);

    // Apply auto-fit column widths
    const maxColWidths = sheetHeaders.map((header, colIdx) => {
      let maxLength = String(header || '').length;
      sheetRows.forEach(row => {
        const val = row[colIdx];
        if (val !== undefined && val !== null) {
          maxLength = Math.max(maxLength, String(val).length);
        }
      });
      // Set reasonable minimum/maximum bounds for columns in Excel (with padding)
      return { wch: Math.min(Math.max(maxLength + 3, 10), 65) };
    });
    worksheet['!cols'] = maxColWidths;

    // Create workbook and append sheet
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Phản hồi');

    // Save actual file
    const rawFileName = `Bao_cao_Excel_Form_${form.title}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    const excelFileName = removeVietnameseTones(rawFileName).replace(/\s+/g, '_');
    XLSX.writeFile(workbook, excelFileName);
  };

  const selectedDetails = selectedToDelete ? (() => {
    const res = filteredResponses.find(r => r.responseId === selectedToDelete.id);
    if (res) {
      return getRowMainDetails(res.rowValues, headers, res.timestamp, res.email);
    }
    return { name: selectedToDelete.email, date: selectedToDelete.timestamp, dept: '-' };
  })() : null;

  return (
    <div className="space-y-6">
      {/* Back button and quick actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <button
          onClick={onBack}
          className="flex items-center space-x-2 text-slate-600 hover:text-indigo-600 font-sans font-bold text-xs select-none hover:-translate-x-0.5 transition-all mr-auto cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>QUAY LẠI BỘ LỌC BIỂU MẪU</span>
        </button>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={onRefresh}
            className="flex items-center space-x-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 active:scale-95 transition-all select-none shadow-xs cursor-pointer"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Đồng bộ từ Sheets</span>
          </button>

          <button
            onClick={handleExportExcel}
            className="flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl px-4 py-2.5 text-xs font-bold active:scale-95 transition-all select-none shadow-md shadow-emerald-100 cursor-pointer animate-fade-in"
          >
            <FileSpreadsheet className="h-4 w-4" />
            <span>Xuất báo cáo Excel</span>
          </button>

          <button
            onClick={handleExportPDF}
            className="flex items-center space-x-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-4 py-2.5 text-xs font-bold active:scale-95 transition-all select-none shadow-md shadow-indigo-100 cursor-pointer"
          >
            <Download className="h-4 w-4" />
            <span>Xuất báo cáo PDF</span>
          </button>

          {selectedIds.length > 0 && (
            <button
              onClick={() => setShowBulkDeleteConfirm(true)}
              disabled={isDeleting}
              className="flex items-center space-x-1.5 bg-rose-605 bg-rose-600 hover:bg-rose-700 text-white rounded-xl px-4 py-2.5 text-xs font-bold active:scale-95 transition-all select-none cursor-pointer shrink-0 shadow-md shadow-rose-100 animate-fade-in"
            >
              <Trash2 className={`h-4 w-4 ${isDeleting ? 'animate-spin' : ''}`} />
              <span>Xóa phản hồi đã chọn ({selectedIds.length})</span>
            </button>
          )}

          {responses.length > 0 && (
            <button
              onClick={() => setShowAllClearConfirm(true)}
              disabled={isDeletingAll}
              className={`flex items-center space-x-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 rounded-xl px-4 py-2.5 text-xs font-bold active:scale-95 transition-all select-none cursor-pointer shrink-0 ${isDeletingAll ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Trash2 className={`h-4 w-4 ${isDeletingAll ? 'animate-spin' : ''}`} />
              <span>{isDeletingAll ? 'Đang xóa...' : 'Xóa toàn bộ phản hồi'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Form Details Header */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm text-left">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider bg-indigo-50 text-indigo-600 px-3 py-1 rounded-md border border-indigo-100/60">
              Kiểm tra Phản hồi
            </span>
            <h2 className="font-sans font-black text-2xl text-slate-900 tracking-tight italic mt-2.5">{form.title}</h2>
            <p className="text-slate-500 text-xs mt-1 max-w-2xl leading-relaxed">{form.description || 'Không có mô tả chi tiết từ Forms.'}</p>
          </div>
          
          <div className="flex items-center space-x-4 bg-slate-50 p-4 rounded-2xl shrink-0 border border-slate-100">
            <div className="text-center px-4">
              <span className="block text-2xl font-black font-sans text-slate-800">{responses.length}</span>
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest block mt-0.5">Hàng dữ liệu</span>
            </div>
            <div className="h-8 w-px bg-slate-200" />
            <div className="text-center px-4">
              <span className="block text-2xl font-black font-sans text-indigo-600">{filteredResponses.length}</span>
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest block mt-0.5">Đã lọc ra</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-sm flex flex-col md:flex-row gap-3">
        {/* Search input */}
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-3 text-slate-400 h-4.5 w-4.5" />
          <input
            type="text"
            placeholder="Tìm kiếm đa cột đồng thời (sử dụng dấu ';' hoặc ',' để phân tách... VD: cánh ; kim)"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 bg-slate-50 focus:bg-white text-slate-700 font-semibold transition-all placeholder:text-slate-450"
          />
        </div>

        {/* Email options selector */}
        <div className="relative w-full md:w-[220px]">
          <select
            value={filterEmail}
            onChange={(e) => setFilterEmail(e.target.value)}
            className="w-full px-3.5 py-2.5 text-xs border border-slate-200 rounded-xl bg-slate-50 hover:bg-white focus:bg-white transition-all outline-none text-slate-650 font-bold cursor-pointer"
          >
            <option value="">Lọc theo Người gửi / Email</option>
            {uniqueEmails.map((email) => (
              <option key={email} value={email}>
                {email}
              </option>
            ))}
          </select>
        </div>

        {/* Sort order toggle */}
        <button
          onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
          className="flex items-center justify-center space-x-1.5 border border-slate-200 py-2.5 px-4 rounded-xl text-xs bg-slate-50 hover:bg-white active:scale-95 transition-all text-slate-600 font-bold shrink-0 shadow-xs select-none cursor-pointer"
        >
          <ArrowUpDown className="h-3.5 w-3.5 text-slate-450" />
          <span>Thời gian: {sortOrder === 'desc' ? 'Cận nhất' : 'Xưa nhất'}</span>
        </button>
      </div>

      {/* RESPONSIVE RESPONSES PREVIEW */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden text-left">
        {/* View Mode Toggle Header */}
        <div className="px-5 py-4 bg-slate-50/80 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-4">
            <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse shrink-0" />
            <label className="flex items-center space-x-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filteredResponses.length > 0 && filteredResponses.every(r => selectedIds.includes(r.responseId))}
                onChange={handleToggleSelectAll}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/15 focus:ring-offset-0 focus:ring-2 accent-indigo-600 cursor-pointer"
              />
              <span className="font-sans text-slate-700 text-xs font-bold uppercase tracking-wider">Chọn tất cả ({filteredResponses.length} bản ghi)</span>
            </label>
          </div>
          
          <div className="flex items-center p-1 bg-slate-200/60 rounded-xl space-x-1 select-none shrink-0 self-start sm:self-auto">
            <button
              onClick={() => setViewMode('simple')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                viewMode === 'simple' 
                  ? 'bg-white text-indigo-600 shadow-xs' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Chế độ rút gọn
            </button>
            <button
              onClick={() => setViewMode('full')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                viewMode === 'full' 
                  ? 'bg-white text-indigo-600 shadow-xs' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Bảng biểu đầy đủ
            </button>
          </div>
        </div>

        {filteredResponses.length === 0 ? (
          <div className="text-center py-20 px-4">
            <Search className="h-10 w-10 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-800 text-sm font-bold uppercase tracking-wider">Không tìm thấy bản ghi phù hợp</p>
            <p className="text-xs text-slate-400 mt-1">Thay đổi từ khóa tìm kiếm hoặc bộ lọc để thu hẹp kết quả.</p>
          </div>
        ) : (
          <>
            {/* Simple Line List View (Extremely clean & exactly matches user request!) */}
            {viewMode === 'simple' && (
              <div className="p-4 space-y-3 font-sans">
                {filteredResponses.map((res, index) => {
                  const actualRowIdx = res.originalIndex !== undefined 
                    ? res.originalIndex 
                    : rawRows.findIndex(
                        (row) => row[0] === res.timestamp && (row[1] || 'Ẩn danh') === res.email
                      );
                  
                  const scoreVal = res.rowValues?.[scoreIdx] || '-';
                  const evaluatorVal = res.rowValues?.[evaluatorIdx] || '-';
                  const evaluatedVal = res.rowValues?.[evaluatedIdx] || '-';
                  const timestampVal = res.rowValues?.[timestampIdx] || res.timestamp;
                  const evalTimeVal = res.rowValues?.[evalTimeIdx] || '-';

                  return (
                    <div 
                      key={index} 
                      className={`grid grid-cols-1 md:grid-cols-12 items-center p-4 transition-all rounded-2xl border gap-4 ${
                        selectedIds.includes(res.responseId) 
                          ? 'border-indigo-400 bg-indigo-50/25 shadow-2xs' 
                          : 'border-slate-150 bg-slate-50/60 hover:bg-slate-50'
                      }`}
                    >
                      {/* Column 1: STT + Score + Evaluated target info (5/12 columns) */}
                      <div className="md:col-span-5 flex items-center space-x-3 min-w-0">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(res.responseId)}
                          onChange={() => handleToggleSelectItem(res.responseId)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/10 focus:ring-offset-0 focus:ring-2 accent-indigo-600 cursor-pointer shrink-0"
                        />

                        <span className="font-mono text-xs font-black text-slate-400 bg-slate-200/60 rounded-xl w-7 h-7 flex items-center justify-center shrink-0">
                          {index + 1}
                        </span>

                        {/* Điểm số Badge */}
                        <div className="bg-indigo-50 border border-indigo-100 text-indigo-700 font-mono font-bold px-3 py-1.5 rounded-xl text-center min-w-[75px] shrink-0 shadow-2xs">
                          <span className="text-[9px] block text-indigo-400 uppercase tracking-widest font-sans font-bold leading-none mb-1">Điểm số</span>
                          <span className="text-xs leading-none">{scoreVal}</span>
                        </div>
                        
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <span className="text-[9px] text-slate-400 uppercase tracking-wide font-extrabold block">Nhân viên được đánh giá</span>
                          <p className="font-extrabold text-slate-900 text-sm md:text-md truncate" title={evaluatedVal}>
                            {normalizeEmailOrName(evaluatedVal)}
                          </p>
                        </div>
                      </div>

                      {/* Column 2: Người đánh giá (2/12 columns) */}
                      <div className="md:col-span-2 space-y-0.5 min-w-0">
                        <span className="text-[9px] text-slate-400 uppercase tracking-wide font-extrabold block">Người đánh giá</span>
                        <span className="text-slate-700 font-semibold text-xs flex items-center space-x-1.5">
                          <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          <span className="truncate">{normalizeEmailOrName(evaluatorVal)}</span>
                        </span>
                      </div>

                      {/* Column 3: Dấu thời gian (2/12 columns) */}
                      <div className="md:col-span-2 space-y-0.5 min-w-0">
                        <span className="text-[9px] text-slate-400 uppercase tracking-wide font-extrabold block">Dấu thời gian</span>
                        <span className="text-slate-500 font-medium text-xs flex items-center space-x-1.5">
                          <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          <span className="font-mono text-[11px]">{formatDisplayDate(timestampVal)}</span>
                        </span>
                      </div>

                      {/* Column 4: Thời gian đánh giá (2/12 columns) */}
                      <div className="md:col-span-2 space-y-0.5 min-w-0">
                        <span className="text-[9px] text-slate-400 uppercase tracking-wide font-extrabold block">Thời gian đánh giá</span>
                        <span className="text-indigo-600 font-semibold text-xs flex items-center space-x-1.5">
                          <Calendar className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                          <span className="font-mono text-[11px]">{formatDisplayDate(evalTimeVal)}</span>
                        </span>
                      </div>

                      {/* Column 5: Actions (1/12 columns) */}
                      <div className="md:col-span-1 flex items-center justify-end shrink-0 md:pl-2 border-t md:border-t-0 pt-2.5 md:pt-0 border-slate-100">
                        <button
                          onClick={() => handleOpenConfirm(res.responseId, res.email, res.timestamp, actualRowIdx)}
                          className="p-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 active:scale-95 rounded-xl transition-all cursor-pointer border border-transparent hover:border-rose-100"
                          title="Xóa phản hồi vĩnh viễn"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Desktop Table view */}
            {viewMode === 'full' && (
              <>
                <div className="hidden md:block overflow-x-auto w-full font-sans">
                  <table className="min-w-full divide-y divide-slate-200 table-auto text-left">
                    <thead className="bg-slate-50/80">
                      <tr>
                        <th scope="col" className="w-[42px] px-4 py-4 text-center">
                          <input
                            type="checkbox"
                            checked={filteredResponses.length > 0 && filteredResponses.every(r => selectedIds.includes(r.responseId))}
                            onChange={handleToggleSelectAll}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/10 focus:ring-offset-0 focus:ring-2 accent-indigo-600 cursor-pointer"
                          />
                        </th>
                        <th scope="col" className="w-[60px] px-6 py-4 text-[9px] font-extrabold text-slate-500 uppercase tracking-widest text-center italic font-sans animate-fade-in">STT</th>
                        
                        {focusedCols.map((col, i) => (
                          <th 
                            key={i} 
                            scope="col" 
                            className={`px-6 py-4 text-[9px] font-extrabold text-slate-500 uppercase tracking-widest italic truncate font-sans min-w-[125px] ${
                              col.key === 'score' ? 'text-center' : ''
                            }`}
                          >
                            {col.title}
                          </th>
                        ))}
                        
                        <th scope="col" className="w-[100px] px-6 py-4 text-[9px] font-extrabold text-slate-500 uppercase tracking-widest text-center italic font-sans animate-fade-in w-[110px]">Hành động</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-705 text-xs font-sans">
                      {filteredResponses.map((res, index) => {
                        const actualRowIdx = res.originalIndex !== undefined 
                          ? res.originalIndex 
                          : rawRows.findIndex(
                              (row) => row[0] === res.timestamp && (row[1] || 'Ẩn danh') === res.email
                            );

                        return (
                          <tr key={index} className={`hover:bg-slate-50/50 transition-colors group ${selectedIds.includes(res.responseId) ? 'bg-indigo-50/30' : ''}`}>
                            <td className="px-4 py-4 text-center">
                              <input
                                type="checkbox"
                                checked={selectedIds.includes(res.responseId)}
                                onChange={() => handleToggleSelectItem(res.responseId)}
                                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/10 focus:ring-offset-0 focus:ring-2 accent-indigo-600 cursor-pointer"
                              />
                            </td>
                            <td className="px-6 py-4 text-center text-slate-450 font-mono font-black text-xs">{index + 1}</td>
                            
                            {focusedCols.map((col, i) => {
                              const val = res.rowValues?.[col.index] || '';
                              const displayVal = (col.key === 'evalTime' || col.key === 'timestamp') ? formatDisplayDate(val) : val;
                              
                              return (
                                <td 
                                  key={i} 
                                  className={`px-6 py-4 truncate max-w-[250px] ${
                                    col.key === 'score' 
                                      ? 'text-center' 
                                      : col.key === 'evaluated' 
                                        ? 'font-semibold text-slate-800' 
                                        : 'font-medium text-slate-600'
                                  }`}
                                >
                                  {col.key === 'score' ? (
                                    <span className="inline-block bg-indigo-50 border border-indigo-100 text-indigo-700 font-mono font-bold px-3 py-1 rounded-xl text-xs">
                                      {val || '-'}
                                    </span>
                                  ) : (
                                    <span className="flex items-center space-x-1.5 truncate">
                                      {col.key === 'timestamp' && <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
                                      {col.key === 'evalTime' && <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
                                      {col.key === 'evaluator' && <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
                                      <span className="truncate">
                                        {(col.key === 'evaluator' || col.key === 'evaluated') ? normalizeEmailOrName(displayVal) : displayVal || '-'}
                                      </span>
                                    </span>
                                  )}
                                </td>
                              );
                            })}

                            {/* Delete action */}
                            <td className="px-6 py-4 text-center">
                              <button
                                onClick={() => handleOpenConfirm(res.responseId, res.email, res.timestamp, actualRowIdx)}
                                className="p-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                                title="Xóa phản hồi vĩnh viễn"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Cards view (Extremely optimized for mobile screens!) */}
                <div className="block md:hidden divide-y divide-slate-100">
                  {filteredResponses.map((res, index) => {
                    const actualRowIdx = res.originalIndex !== undefined 
                      ? res.originalIndex 
                      : rawRows.findIndex(
                          (row) => row[0] === res.timestamp && (row[1] || 'Ẩn danh') === res.email
                        );

                    const scoreVal = res.rowValues?.[scoreIdx] || '-';
                    const evaluatorVal = res.rowValues?.[evaluatorIdx] || '-';
                    const evaluatedVal = res.rowValues?.[evaluatedIdx] || '-';
                    const timestampVal = res.rowValues?.[timestampIdx] || res.timestamp;
                    const evalTimeVal = res.rowValues?.[evalTimeIdx] || '-';

                    return (
                      <div key={index} className={`p-4 space-y-3 transition-colors ${selectedIds.includes(res.responseId) ? 'bg-indigo-50/20 border-l-4 border-indigo-500' : 'hover:bg-slate-50/30'}`}>
                        {/* Card Header: STT, Email and Delete Icon */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2.5">
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(res.responseId)}
                              onChange={() => handleToggleSelectItem(res.responseId)}
                              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/10 focus:ring-offset-0 focus:ring-2 accent-indigo-600 cursor-pointer shrink-0"
                            />
                            <span className="text-xs font-mono font-bold text-slate-400 bg-slate-100 rounded-md px-1.5 py-0.5">
                              #{index + 1}
                            </span>
                            <span className="text-xs font-semibold text-slate-800 flex items-center space-x-1 font-sans">
                              <Mail className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                              <span className="truncate max-w-[170px]">{normalizeEmailOrName(res.email)}</span>
                            </span>
                          </div>
                          <button
                            onClick={() => handleOpenConfirm(res.responseId, res.email, res.timestamp, actualRowIdx)}
                            className="p-2 text-rose-500 hover:bg-rose-50 hover:text-rose-700 rounded-lg transition-all"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>

                        {/* Questions & Answers breakdown (Rendering focused indices) */}
                        <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-100 space-y-2.5 mt-2 font-sans">
                          {/* Top Info Header */}
                          <div className="grid grid-cols-3 gap-2 border-b border-slate-100 pb-2">
                            <div className="text-left">
                              <p className="text-[8px] font-sans font-bold text-slate-400 uppercase leading-none">
                                Điểm số
                              </p>
                              <span className="inline-block bg-indigo-50 border border-indigo-100 text-indigo-700 font-mono font-bold px-1.5 py-0.5 rounded-lg text-xs mt-1">
                                {scoreVal || '-'}
                              </span>
                            </div>
                            <div className="text-center">
                              <p className="text-[8px] font-sans font-bold text-slate-400 uppercase leading-none">
                                Dấu thời gian
                              </p>
                              <p className="text-[10px] text-slate-600 font-mono mt-1.5 flex items-center justify-center space-x-0.5">
                                <Clock className="h-3 w-3 text-slate-400 shrink-0" />
                                <span className="truncate">{formatDisplayDate(timestampVal)}</span>
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-[8px] font-sans font-bold text-slate-400 uppercase leading-none">
                                T.Gian đánh giá
                              </p>
                              <p className="text-[10px] text-indigo-600 font-semibold mt-1.5 flex items-center justify-end space-x-0.5">
                                <Calendar className="h-3 w-3 text-indigo-400 shrink-0" />
                                <span className="truncate">{formatDisplayDate(evalTimeVal)}</span>
                              </p>
                            </div>
                          </div>

                          <div className="text-left font-sans">
                            <p className="text-[9px] font-sans font-bold text-slate-450 uppercase">
                              Nhân viên được đánh giá
                            </p>
                            <p className="text-xs text-slate-800 font-bold leading-relaxed truncate mt-0.5 pl-0.5">
                              {normalizeEmailOrName(evaluatedVal) || '-'}
                            </p>
                          </div>

                          <div className="text-left font-sans">
                            <p className="text-[9px] font-sans font-bold text-slate-450 uppercase">
                              Người đánh giá
                            </p>
                            <p className="text-xs text-slate-600 font-medium leading-relaxed truncate mt-0.5 pl-0.5 flex items-center space-x-1 font-sans">
                              <User className="h-3.5 w-3.5 text-slate-450 shrink-0" />
                              <span>{normalizeEmailOrName(evaluatorVal) || '-'}</span>
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* MOCK/GUIDE WARNING ABOUT FORM SYNC EXTENSION */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 flex space-x-3.5 items-start">
        <Info className="h-5.5 w-5.5 text-indigo-500 shrink-0 mt-0.5" />
        <div className="space-y-1.5 text-left">
          <h4 className="text-sm font-semibold text-slate-800">Quy trình dọn dẹp vệ sinh phản hồi triệt để</h4>
          <p className="text-xs text-slate-600 leading-normal">
            Ứng dụng sẽ xóa vĩnh viễn dòng dữ liệu của phản hồi này trong file Google Sheets liên kết của bạn. Do thiết kế bảo mật của Google Workspace, xóa dòng trong Sheets sẽ cập nhật lập tức hệ thống hiển thị, đồng thời thông qua bộ kích hoạt Apps Script liên kết (tại phần "Đồng bộ") nó cũng sẽ gọi lệnh xóa phản hồi đó trong lõi biểu mẫu Google Forms.
          </p>
        </div>
      </div>

      {/* CUSTOM DESTROY MULTIPLE SELECTED CONFIRMATION DIALOG (MANDATORY SECURITY COMPLIANCE) */}
      {showBulkDeleteConfirm && selectedDetailsToBulkDelete.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none">
          {/* Backdrop */}
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={() => setShowBulkDeleteConfirm(false)} />
          
          {/* Box Dialog */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-xl max-w-lg w-full p-6 relative z-10 space-y-4">
            <div className="flex items-center space-x-3 text-red-650">
              <div className="p-2.5 bg-red-50 rounded-xl text-red-650">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <h3 className="font-sans font-bold text-base text-red-650">Xác nhận xóa hàng loạt ({selectedDetailsToBulkDelete.length} phản hồi)!</h3>
            </div>
            
            <div className="text-slate-600 text-xs leading-relaxed space-y-3">
              <p className="font-medium text-slate-700">
                Bạn đã chọn xóa vĩnh viễn {selectedDetailsToBulkDelete.length} phản hồi sau đây. Vui lòng rà soát kỹ lưỡng danh sách trước khi thực hiện:
              </p>
              
              {/* Detailed Scrollable List */}
              <div className="bg-slate-50 rounded-2xl p-2 border border-slate-150 max-h-48 overflow-y-auto space-y-2 scrollbar-thin">
                {selectedDetailsToBulkDelete.map((item, i) => (
                  <div key={item.responseId} className="bg-white p-3 rounded-xl border border-slate-100 flex items-center justify-between gap-3 text-left">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="font-extrabold text-slate-900 text-[11.5px] truncate">
                        {i + 1}. {item.name || 'Ẩn danh'} <span className="font-mono text-[9px] text-slate-400 font-bold bg-slate-100 px-1.5 py-0.5 rounded ml-1">Hàng {item.rowIndex + 2}</span>
                      </p>
                      <p className="text-[10px] text-slate-500 font-medium truncate">
                        Khoa/Bộ phận: {item.dept || '-'}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-slate-400 font-medium">Thời gian</p>
                      <p className="text-[10.5px] font-semibold text-indigo-650 font-mono">{formatDisplayDate(item.timestamp)}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-1 bg-amber-50/50 p-3 rounded-2xl border border-amber-100 text-[11px] text-amber-800">
                <p className="font-bold uppercase tracking-wider text-[9.5px]">Thao tác kép tự động:</p>
                <p>• Xóa sạch triệt để {selectedDetailsToBulkDelete.length} hàng tương ứng trên file Google Sheet kết nối.</p>
                <p>• Gửi yêu cầu qua Apps Script Web App để dọn dẹp các phản hồi gốc này trong Google Form (nếu đã kết nối).</p>
              </div>

              <p className="text-rose-600 font-bold bg-rose-50 p-3 rounded-2xl border border-rose-100 text-[11.5px] text-center">
                CẢNH BÁO: Thao tác xóa hàng loạt KHÔNG THỂ HOÀN TÁC dưới bất kỳ hình thức nào!
              </p>
            </div>
            
            {/* Buttons */}
            <div className="flex justify-end space-x-2.5 pt-2">
              <button
                onClick={() => setShowBulkDeleteConfirm(false)}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-semibold select-none active:scale-95 transition-all outline-none"
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleConfirmBulkDelete}
                disabled={isDeleting}
                className="px-5 py-2.5 bg-red-650 hover:bg-red-700 disabled:bg-slate-350 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-100 select-none active:scale-95 transition-all flex items-center space-x-1.5"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Đang xóa...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Xác nhận xóa hàng loạt</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM DESTROY CONFIRMATION DIALOG (MANDATORY SECURITY COMPLIANCE) */}
      {showConfirm && selectedToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={() => setShowConfirm(false)} />
          
          {/* Box Dialog */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-xl max-w-md w-full p-6 relative z-10 space-y-4">
            <div className="flex items-center space-x-3 text-red-600">
              <div className="p-2.5 bg-red-50 rounded-xl">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <h3 className="font-sans font-bold text-base">Xác nhận xóa vĩnh viễn!</h3>
            </div>
            
            <div className="text-slate-600 text-xs leading-relaxed space-y-2">
              <p>
                Bạn đang thực hiện thao tác xóa dữ liệu người dùng. Vui lòng xác minh hành vi trước khi tiếp tục:
              </p>
              <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100 space-y-1.5 font-sans text-xs text-slate-700">
                <p><strong>• Nhân viên được đánh giá:</strong> <span className="font-semibold text-slate-900">{selectedDetails?.name}</span></p>
                <p><strong>• Khoa - Bộ phận:</strong> <span className="font-semibold text-slate-900">{selectedDetails?.dept}</span></p>
                <p><strong>• Thời gian đánh giá:</strong> <span className="font-semibold text-slate-900">{selectedDetails ? formatDisplayDate(selectedDetails.date) : ''}</span></p>
                <p className="text-[10px] font-mono text-slate-400 mt-1"><strong>• Dòng Google Sheets:</strong> Hàng số {selectedToDelete.rowIndex + 2}</p>
              </div>
              <p className="text-rose-600 font-semibold bg-rose-50 p-2.5 rounded-lg border border-rose-100">
                Lưu ý: Thao tác này KHÔNG THỂ HOÀN TÁC. Dòng tương ứng trên Google Spreadsheet sẽ bị xoá bỏ triệt để.
              </p>
            </div>
            
            {/* Buttons */}
            <div className="flex justify-end space-x-2.5 pt-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-semibold select-none active:scale-95 transition-all outline-none"
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-100 select-none active:scale-95 transition-all flex items-center space-x-1.5"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Đang xóa...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Xác nhận xóa</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM DESTROY ALL CONFIRMATION DIALOG (MANDATORY SECURITY COMPLIANCE) */}
      {showAllClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={() => setShowAllClearConfirm(false)} />
          
          {/* Box Dialog */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-xl max-w-md w-full p-6 relative z-10 space-y-4">
            <div className="flex items-center space-x-3 text-red-650">
              <div className="p-2.5 bg-red-50 rounded-xl text-red-600">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <h3 className="font-sans font-bold text-base text-red-600">Xác nhận xóa TOÀN BỘ phản hồi!</h3>
            </div>
            
            <div className="text-slate-600 text-xs leading-relaxed space-y-2">
              <p>
                Bạn đang thực hiện thao tác xóa sạch toàn bộ phản hồi của biểu mẫu:
              </p>
              <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100 space-y-1.5 font-sans text-xs text-slate-700">
                <p><strong>• Biểu mẫu:</strong> <span className="font-semibold text-slate-900">{form.title}</span></p>
                <p><strong>• Tổng số lượng:</strong> <span className="font-semibold text-rose-600">{responses.length} phản hồi hàng loạt</span></p>
              </div>
              <p className="text-xs text-slate-600">
                Hành động này sẽ:
                <br/>1. Xóa toàn bộ hàng dữ liệu hiện có trên tệp Google Sheets liên kết (chỉ giữ lại hàng tiêu đề đầu tiên).
                <br/>2. Tự động xóa sạch toàn bộ phản hồi gốc tương ứng trong phần lõi của Google Forms nếu bạn đã cấu hình Apps Script Web App.
              </p>
              <p className="text-rose-600 font-semibold bg-rose-50 p-2.5 rounded-lg border border-rose-100 text-[11px]">
                CẢNH BÁO: Thao tác này là thao tác huỷ hoại dữ liệu vĩnh viễn và KHÔNG THỂ KHÔI PHỤC dưới bất kỳ hình thức nào!
              </p>
            </div>
            
            {/* Buttons */}
            <div className="flex justify-end space-x-2.5 pt-2">
              <button
                onClick={() => setShowAllClearConfirm(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-semibold select-none active:scale-95 transition-all outline-none"
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleConfirmClearAll}
                disabled={isDeletingAll}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-100 select-none active:scale-95 transition-all flex items-center space-x-1.5"
              >
                {isDeletingAll ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Đang xóa...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Xác nhận xóa sạch</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
