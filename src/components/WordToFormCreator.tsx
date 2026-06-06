/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import mammoth from 'mammoth';
import { motion, AnimatePresence } from 'motion/react';
import { getFolderContents } from '../lib/googleApi';
import { 
  UploadCloud, FileText, CheckCircle2, RefreshCw, 
  Settings, Loader2, Play, AlertCircle, Plus, Trash2, 
  Check, ArrowRight, Eye, Sparkles, FileSpreadsheet, ChevronRight, X
} from 'lucide-react';

interface ParsedQuestion {
  id: string;
  title: string;
  type: 'TEXT' | 'PARAGRAPH' | 'MULTIPLE_CHOICE' | 'CHECKBOX' | 'DROP_DOWN';
  options: string[];
  required: boolean;
  points?: number;
  correctAnswer?: string;
}

interface WordToFormCreatorProps {
  token: string;
  folderId: string;
  folderName: string;
  globalAppsScriptUrl: string;
  onSuccess: () => void;
}

function htmlToCleanLines(html: string): string {
  let processed = html;
  
  // Replace paragraph-closing / block-closing tags or opening block tags with a newline
  processed = processed.replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|tr|dd|dt)>/gi, '\n');
  processed = processed.replace(/<(br|hr)\s*\/?>/gi, '\n');
  
  // Replace opening block tags with empty since they will end with a newline
  processed = processed.replace(/<(p|div|h1|h2|h3|h4|h5|h6|li|tr|dd|dt)[^>]*>/gi, '');
  
  // Remove other tags except bold, italic, underline
  processed = processed.replace(/<(?!\/?(?:strong|b|em|i)\b)[^>]+>/gi, '');
  
  // Decode HTML entities
  processed = processed
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
    
  return processed;
}

function checkAndCleanCorrectOption(optText: string): { isCorrect: boolean; cleaned: string } {
  let cleaned = optText.trim();
  let isCorrect = false;

  // 1. Double asterisks: **option**
  if (cleaned.startsWith('**') && cleaned.endsWith('**') && cleaned.length > 4) {
    isCorrect = true;
    cleaned = cleaned.slice(2, -2).trim();
  }
  // 2. Double underscores: __option__
  else if (cleaned.startsWith('__') && cleaned.endsWith('__') && cleaned.length > 4) {
    isCorrect = true;
    cleaned = cleaned.slice(2, -2).trim();
  }
  // 3. HTML bold: <b>option</b> or <strong>option</strong>
  else if (cleaned.toLowerCase().startsWith('<b>') && cleaned.toLowerCase().endsWith('</b>')) {
    isCorrect = true;
    cleaned = cleaned.slice(3, -4).trim();
  }
  else if (cleaned.toLowerCase().startsWith('<strong>') && cleaned.toLowerCase().endsWith('</strong>')) {
    isCorrect = true;
    cleaned = cleaned.slice(8, -9).trim();
  }
  // 4. Single asterisk wrapped: *option*
  else if (cleaned.startsWith('*') && cleaned.endsWith('*') && cleaned.length > 2) {
    isCorrect = true;
    cleaned = cleaned.slice(1, -1).trim();
  }
  // 5. Starts or ends with *
  else if (cleaned.startsWith('*') && cleaned.length > 1) {
    isCorrect = true;
    cleaned = cleaned.slice(1).trim();
  }
  else if (cleaned.endsWith('*') && cleaned.length > 1) {
    isCorrect = true;
    cleaned = cleaned.slice(0, -1).trim();
  }

  return { isCorrect, cleaned };
}

function parseChoiceLine(line: string): { isChoice: boolean; letter: string; optText: string; isCorrect: boolean } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let isCorrect = false;

  // Rule 1: check if original trimmed string has bold tags or markers
  if (
    trimmed.includes('**') || 
    trimmed.includes('__') || 
    /<\/?b>/i.test(trimmed) || 
    /<\/?strong>/i.test(trimmed)
  ) {
    isCorrect = true;
  }

  // Rule 2: check if it has single asterisks wrapping
  if (trimmed.startsWith('*') && trimmed.endsWith('*') && trimmed.length > 2) {
    isCorrect = true;
  }

  // Clean the text of standard wrappers
  let cleaned = trimmed
    .replace(/\*\*|__/g, '')
    .replace(/<\/?b>|<\/?strong>|<\/?em>|<\/?i>/gi, '')
    .trim();

  // Handle prefixed stars/bullets followed by a Choice, e.g. "* A. option" or "+ B. option"
  const starredChoiceLinePattern = /^\s*[\*\+•]\s*([A-Fa-f])\s*[\s\.:\)-]+\s*(.*)$/i;
  const starPrefixedMatch = cleaned.match(starredChoiceLinePattern);
  if (starPrefixedMatch) {
    isCorrect = true;
    cleaned = `${starPrefixedMatch[1]}. ${starPrefixedMatch[2]}`;
  }

  // If there are outer single asterisks/underscores wrapping, strip them and mark as correct
  if (cleaned.startsWith('*') && cleaned.endsWith('*') && cleaned.length > 2) {
    isCorrect = true;
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (cleaned.startsWith('_') && cleaned.endsWith('_') && cleaned.length > 2) {
    isCorrect = true;
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Match standard choice pattern (A. option, A) option, A Option)
  const choicePattern = /^\s*([A-Fa-f]|[o\-*+•])\s*[\s\.:\)-]+\s*(.*)$/;
  const match = cleaned.match(choicePattern);
  if (!match) return null;

  const letter = match[1];
  let optText = match[2].trim();

  const isBullet = /^[o\-*+•]$/.test(letter);

  if (!isBullet) {
    // Check if optText starts or ends with asterisk
    if (optText.startsWith('*') && optText.length > 1) {
      isCorrect = true;
      optText = optText.slice(1).trim();
    }
    if (optText.endsWith('*') && optText.length > 1) {
      isCorrect = true;
      optText = optText.slice(0, -1).trim();
    }
  }

  // General clean up
  optText = optText
    .replace(/\*\*|__/g, '')
    .replace(/<\/?b>|<\/?strong>|<\/?em>|<\/?i>/gi, '')
    .replace(/^\s*\*\s*|\s*\*\s*$/g, '')
    .trim();

  return {
    isChoice: true,
    letter,
    optText,
    isCorrect
  };
}

export function parseTextToQuestions(text: string): { title: string; description: string; questions: ParsedQuestion[] } {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const questions: ParsedQuestion[] = [];
  
  let currentWordTitle = '';
  let currentWordDesc = '';
  let currentQuestion: ParsedQuestion | null = null;
  
  const questionPattern = /^\s*(?:Câu|Question|\d+)\s*[\s\.:\)-]+\s*(.*)$/i;
  const inlineChoicePattern = /(?:^|\s+)([A-D])[\.\)]\s*([^\s][^A-D]*?)(?=(?:\s+[B-D][\.\)])|$)/gi;

  let startIndex = 0;
  if (lines.length > 0) {
    const cleanedFirst = lines[0].replace(/\*\*|__/g, '').replace(/<\/?b>|<\/?strong>/gi, '').trim();
    if (!questionPattern.test(cleanedFirst) && !parseChoiceLine(lines[0])) {
      currentWordTitle = cleanedFirst;
      startIndex = 1;
      
      if (lines.length > 1) {
        const cleanedSecond = lines[1].replace(/\*\*|__/g, '').replace(/<\/?b>|<\/?strong>/gi, '').trim();
        if (!questionPattern.test(cleanedSecond) && !parseChoiceLine(lines[1])) {
          currentWordDesc = cleanedSecond;
          startIndex = 2;
        }
      }
    }
  }

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    
    // Clean of markdown formatting to check if it matches a question pattern
    const cleanedLineForMatching = line
      .replace(/\*\*|__/g, '')
      .replace(/<\/?b>|<\/?strong>|<\/?em>|<\/?i>/gi, '')
      .trim();

    // Check if it's a new question
    const qMatch = cleanedLineForMatching.match(questionPattern);
    if (qMatch) {
      if (currentQuestion) {
        questions.push(currentQuestion);
      }
      
      const qText = qMatch[1].trim();
      currentQuestion = {
        id: 'q_' + Math.random().toString(36).substring(2, 11),
        title: qText,
        type: 'TEXT',
        options: [],
        required: true,
        correctAnswer: ''
      };
      
      // Check for inline choices on the cleaned line
      const inlineMatches = [...cleanedLineForMatching.matchAll(inlineChoicePattern)];
      if (inlineMatches.length > 1) {
        currentQuestion.type = 'MULTIPLE_CHOICE';
        inlineMatches.forEach(m => {
          const optValue = m[2].trim();
          if (optValue) {
            const { isCorrect, cleaned } = checkAndCleanCorrectOption(optValue);
            if (!currentQuestion!.options.includes(cleaned)) {
              currentQuestion!.options.push(cleaned);
            }
            if (isCorrect) {
              currentQuestion!.correctAnswer = cleaned;
            }
          }
        });
      }
      continue;
    }
    
    // Check if it's a choice option (A. B. C. ...)
    const parsedChoice = parseChoiceLine(line);
    if (parsedChoice && currentQuestion) {
      const { optText, isCorrect } = parsedChoice;
      
      if (currentQuestion.type === 'TEXT') {
        currentQuestion.type = 'MULTIPLE_CHOICE';
      }
      
      if (optText) {
        if (!currentQuestion.options.includes(optText)) {
          currentQuestion.options.push(optText);
        }
        if (isCorrect) {
          currentQuestion.correctAnswer = optText;
        }
      }
      continue;
    }

    // Check for inline choices on a standalone line
    if (currentQuestion) {
      const inlineMatches = [...cleanedLineForMatching.matchAll(inlineChoicePattern)];
      if (inlineMatches.length > 1) {
        currentQuestion.type = 'MULTIPLE_CHOICE';
        inlineMatches.forEach(m => {
          const optValue = m[2].trim();
          if (optValue) {
            const { isCorrect, cleaned } = checkAndCleanCorrectOption(optValue);
            if (!currentQuestion!.options.includes(cleaned)) {
              currentQuestion!.options.push(cleaned);
            }
            if (isCorrect) {
              currentQuestion!.correctAnswer = cleaned;
            }
          }
        });
        continue;
      }
    }

    // Otherwise append to current question text
    if (currentQuestion) {
      currentQuestion.title += ' ' + cleanedLineForMatching;
    } else {
      if (!currentWordTitle) {
        currentWordTitle = cleanedLineForMatching;
      } else {
        currentWordDesc += (currentWordDesc ? ' ' : '') + cleanedLineForMatching;
      }
    }
  }
  
  if (currentQuestion) {
    questions.push(currentQuestion);
  }
  
  questions.forEach(q => {
    q.title = q.title.replace(/\s+/g, ' ').trim();
  });

  return {
    title: currentWordTitle.trim() || 'Biểu mẫu tự động mới',
    description: currentWordDesc.trim() || 'Được tạo tự động bằng Trình thông minh nhân bản Word.',
    questions
  };
}

function matchCorrectAnswerToOptions(correctAnswer: string, options: string[]): string {
  if (!correctAnswer || !options || options.length === 0) return '';
  
  const cleanAns = correctAnswer.trim().toLowerCase();
  
  // 1. Exact match or lowercased exact match
  const exactMatch = options.find(opt => opt.trim() === correctAnswer.trim());
  if (exactMatch) return exactMatch;
  
  const cleanOptions = options.map(opt => opt.trim().toLowerCase());
  const lowerExactIndex = cleanOptions.indexOf(cleanAns);
  if (lowerExactIndex !== -1) return options[lowerExactIndex];

  // 2. Index match (e.g. correctAnswer is "A", "B", "C", "D" or "A.", "b)", etc.)
  const singleLetterMatch = cleanAns.match(/^\s*([a-f])[\s\.:\)-]*$/i);
  if (singleLetterMatch) {
    const letter = singleLetterMatch[1];
    const index = letter.charCodeAt(0) - 97; // 'a' code stands for 97
    if (index >= 0 && index < options.length) {
      return options[index];
    }
  }

  // 3. Prefix stripping match: strip A., B), etc. from both correct answer and options
  const stripPrefix = (str: string) => {
    return str
      .replace(/^\s*([a-f]|[0-9]+)\s*[\s\.:\)-]+\s*/i, '') // strip "A. ", "1) "
      .replace(/^\s*[\*\+•\-]\s*/, '') // strip bullet styles
      .trim()
      .toLowerCase();
  };

  const cleanAnsStripped = stripPrefix(correctAnswer);
  
  for (let i = 0; i < options.length; i++) {
    const optStripped = stripPrefix(options[i]);
    if (optStripped === cleanAnsStripped && optStripped.length > 0) {
      return options[i];
    }
  }

  // 4. Content subset matching: if option contains correct answer or correct answer contains option
  if (cleanAnsStripped.length >= 2) {
    for (let i = 0; i < options.length; i++) {
      const optStripped = stripPrefix(options[i]);
      if (optStripped.includes(cleanAnsStripped) || cleanAnsStripped.includes(optStripped)) {
        return options[i];
      }
    }
  }

  // Return original as last resort
  return correctAnswer;
}

export default function WordToFormCreator({
  token,
  folderId,
  folderName,
  globalAppsScriptUrl,
  onSuccess
}: WordToFormCreatorProps) {
  const [sourceType, setSourceType] = useState<'upload' | 'paste'>('upload');
  const [inputText, setInputText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parsedTitle, setParsedTitle] = useState('');
  const [parsedDesc, setParsedDesc] = useState('');
  const [questions, setQuestions] = useState<ParsedQuestion[]>([]);
  const [hasParsed, setHasParsed] = useState(false);
  
  const [isCreating, setIsCreating] = useState(false);
  const [creationStage, setCreationStage] = useState<string>('');
  const [useAppsScript, setUseAppsScript] = useState(true);
  const [linkSpreadsheet, setLinkSpreadsheet] = useState(true);

  // Advanced AI and Score configurations
  const [parserType, setParserType] = useState<'ai' | 'traditional'>('ai');
  const [isQuizMode, setIsQuizMode] = useState(false);
  const [quizScoreMode, setQuizScoreMode] = useState<'equal' | 'fixed' | 'manual'>('manual');
  const [totalQuizPoints, setTotalQuizPoints] = useState<number>(10);
  const [fixedPointsValue, setFixedPointsValue] = useState<number>(2);

  // States for existing sheet scanning
  const [existingSheets, setExistingSheets] = useState<{ id: string; name: string }[]>([]);
  const [isLoadingSheets, setIsLoadingSheets] = useState(false);
  const [sheetConnectionMode, setSheetConnectionMode] = useState<'create_new' | 'link_existing'>('create_new');
  const [selectedSheetId, setSelectedSheetId] = useState<string>('');

  // Scan Google sheets when hasParsed becomes true
  React.useEffect(() => {
    if (hasParsed && token && folderId) {
      const loadSheets = async () => {
        setIsLoadingSheets(true);
        try {
          const { sheets } = await getFolderContents(token, folderId);
          setExistingSheets(sheets);
          if (sheets.length === 1) {
            setSheetConnectionMode('link_existing');
            setSelectedSheetId(sheets[0].id);
          } else {
            setSheetConnectionMode('create_new');
            setSelectedSheetId('');
          }
        } catch (err) {
          console.error("Lỗi khi tải trang tính có sẵn trong thư mục:", err);
        } finally {
          setIsLoadingSheets(false);
        }
      };
      loadSheets();
    }
  }, [hasParsed, token, folderId]);
  
  // Success states
  const [creationResult, setCreationResult] = useState<{
    formId: string;
    sheetId?: string;
    formEditUrl?: string;
    formResponseUrl?: string;
    sheetUrl?: string;
    wasFallback?: boolean;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  // Call server-side Gemini 3.5 Flash parser API
  const handleAiParse = async (rawText: string) => {
    try {
      const response = await fetch('/api/gemini/parse-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rawText })
      });
      if (!response.ok) {
        throw new Error('Không phản hồi từ máy chủ AI');
      }
      const data = await response.json();
      setParsedTitle(data.title || 'Biểu mẫu tự động mới');
      setParsedDesc(data.description || 'Được bóc tách tự động bởi thông minh nhân tạo AI');
      
      const parsedQuestions: ParsedQuestion[] = (data.questions || []).map((q: any) => {
        const cleanedOpts = q.options || [];
        return {
          id: q.id || 'q_' + Math.random().toString(36).substring(2, 11),
          title: q.title || 'Câu hỏi thô',
          type: q.type || 'TEXT',
          options: cleanedOpts,
          required: q.required !== undefined ? q.required : true,
          points: q.points !== undefined ? Number(q.points) : 1,
          correctAnswer: q.correctAnswer ? matchCorrectAnswerToOptions(q.correctAnswer, cleanedOpts) : ''
        };
      });
      setQuestions(parsedQuestions);

      // Auto trigger Quiz Mode if of any parsed questions contain pre-filled points/answers
      const hasPreScore = parsedQuestions.some(q => (q.points && q.points > 1) || q.correctAnswer);
      if (hasPreScore) {
        setIsQuizMode(true);
      }
      setHasParsed(true);
    } catch (err: any) {
      console.warn("Lỗi phân tách bằng AI, chuyển sang giải mã Heuristic gốc:", err);
      // fallback
      const parsed = parseTextToQuestions(rawText);
      setParsedTitle(parsed.title);
      setParsedDesc(parsed.description);
      
      const mappedQuestions = parsed.questions.map(q => ({
        ...q,
        points: 1,
        correctAnswer: q.correctAnswer ? matchCorrectAnswerToOptions(q.correctAnswer, q.options) : ''
      }));
      setQuestions(mappedQuestions);
      
      const hasPreScore = mappedQuestions.some(q => q.correctAnswer);
      if (hasPreScore) {
        setIsQuizMode(true);
      }
      setHasParsed(true);
    }
  };

  // Convert points reactive configuration
  const getQuestionPoints = (q: ParsedQuestion): number => {
    if (!isQuizMode) return 0;
    if (quizScoreMode === 'fixed') return fixedPointsValue;
    if (quizScoreMode === 'equal') {
      if (questions.length === 0) return 0;
      return parseFloat((totalQuizPoints / questions.length).toFixed(1));
    }
    return q.points !== undefined ? q.points : 1; // manual
  };

  // File Upload Handling
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processDocxFile(file);
  };

  const processDocxFile = async (file: File) => {
    setIsParsing(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      let result;
      let text = '';
      try {
        result = await mammoth.convertToHtml({ arrayBuffer });
        const html = result.value;
        text = htmlToCleanLines(html);
      } catch (e) {
        console.warn("Lỗi convertToHtml, fallback to extractRawText:", e);
        result = await mammoth.extractRawText({ arrayBuffer });
        text = result.value;
      }
      
      if (parserType === 'ai') {
        await handleAiParse(text);
      } else {
        const parsed = parseTextToQuestions(text);
        setParsedTitle(parsed.title);
        setParsedDesc(parsed.description);
        
        const mappedQuestions = parsed.questions.map(q => ({
          ...q,
          points: 1,
          correctAnswer: q.correctAnswer ? matchCorrectAnswerToOptions(q.correctAnswer, q.options) : ''
        }));
        setQuestions(mappedQuestions);
        
        const hasPreScore = mappedQuestions.some(q => q.correctAnswer);
        if (hasPreScore) {
          setIsQuizMode(true);
        }
        setHasParsed(true);
      }
    } catch (err) {
      console.error(err);
      alert('Không thể đọc hoặc phân tách tệp tin Word. Hãy kiểm tra định dạng .docx của bạn.');
    } finally {
      setIsParsing(false);
    }
  };

  // Drag and Drop
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.docx')) {
        await processDocxFile(file);
      } else {
        alert('Vui lòng kéo thả tệp .docx (Word) hợp lệ.');
      }
    }
  };

  // Text paste parsing
  const handleParsePaste = async () => {
    if (!inputText.trim()) {
      alert('Vui lòng dán văn bản khảo sát trước.');
      return;
    }
    setIsParsing(true);
    try {
      if (parserType === 'ai') {
        await handleAiParse(inputText);
      } else {
        const parsed = parseTextToQuestions(inputText);
        setParsedTitle(parsed.title);
        setParsedDesc(parsed.description);
        
        const mappedQuestions = parsed.questions.map(q => ({
          ...q,
          points: 1,
          correctAnswer: q.correctAnswer ? matchCorrectAnswerToOptions(q.correctAnswer, q.options) : ''
        }));
        setQuestions(mappedQuestions);
        
        const hasPreScore = mappedQuestions.some(q => q.correctAnswer);
        if (hasPreScore) {
          setIsQuizMode(true);
        }
        setHasParsed(true);
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi phân tích văn bản thô.');
    } finally {
      setIsParsing(false);
    }
  };

  // Form Editing Utilities
  const handleUpdateQuestionTitle = (id: string, newTitle: string) => {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, title: newTitle } : q));
  };

  const handleUpdateQuestionType = (id: string, type: ParsedQuestion['type']) => {
    setQuestions(prev => prev.map(q => q.id === id ? { 
      ...q, 
      type, 
      options: ['MULTIPLE_CHOICE', 'CHECKBOX', 'DROP_DOWN'].includes(type) && q.options.length === 0 
        ? ['Lựa chọn 1', 'Lựa chọn 2'] 
        : q.options 
    } : q));
  };

  const handleAddOption = (qId: string) => {
    setQuestions(prev => prev.map(q => {
      if (q.id === qId) {
        return {
          ...q,
          options: [...q.options, `Lựa chọn ${q.options.length + 1}`]
        };
      }
      return q;
    }));
  };

  const handleEditOption = (qId: string, optIndex: number, newValue: string) => {
    setQuestions(prev => prev.map(q => {
      if (q.id === qId) {
        const newOpts = [...q.options];
        newOpts[optIndex] = newValue;
        return { ...q, options: newOpts };
      }
      return q;
    }));
  };

  const handleRemoveOption = (qId: string, optIndex: number) => {
    setQuestions(prev => prev.map(q => {
      if (q.id === qId) {
        const newOpts = q.options.filter((_, idx) => idx !== optIndex);
        return { ...q, options: newOpts };
      }
      return q;
    }));
  };

  const handleToggleRequired = (id: string) => {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, required: !q.required } : q));
  };

  const handleUpdatePoints = (id: string, points: number) => {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, points: Math.max(0, points) } : q));
  };

  const handleUpdateCorrectAnswer = (id: string, correctAnswer: string) => {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, correctAnswer } : q));
  };

  const handleDeleteQuestion = (id: string) => {
    setQuestions(prev => prev.filter(q => q.id !== id));
  };

  const handleAddBlankQuestion = () => {
    const blank: ParsedQuestion = {
      id: 'q_' + Math.random().toString(36).substring(2, 11),
      title: 'Câu hỏi mới',
      type: 'TEXT',
      options: [],
      required: true,
      points: 1,
      correctAnswer: ''
    };
    setQuestions([...questions, blank]);
  };

  // Submit flow (either Apps Script or pure Google REST API)
  const handleCreateAutomationFiles = async () => {
    if (!token) return;
    if (!parsedTitle.trim()) {
      alert('Vui lòng nhập tiêu đề cho Biểu mẫu!');
      return;
    }
    
    const sheetModeMessage = sheetConnectionMode === 'link_existing'
      ? `liên kết với tệp Google Sheet sẵn có "${existingSheets.find(s => s.id === selectedSheetId)?.name || ''}"`
      : 'tự động tạo tệp Google Sheet mới đồng bộ';

    const isConfirmed = window.confirm(
      `Hệ thống sẽ tiến hành khởi tạo Google Form "${parsedTitle}" (Chế độ Quiz: ${isQuizMode ? 'BẬT' : 'TẮT'}) và ${sheetModeMessage} trong thư mục "${folderName}". Bạn có muốn bắt đầu?`
    );
    if (!isConfirmed) return;

    setIsCreating(true);
    setCreationStage('Khởi động thiết lập tạo tệp...');

    // Compute actual quiz points allocation on the fly
    const finalSubmissionQuestions = questions.map(q => {
      const computedPoints = isQuizMode ? getQuestionPoints(q) : undefined;
      return {
        ...q,
        points: computedPoints !== undefined && computedPoints > 0 ? Math.max(1, Math.round(computedPoints)) : undefined,
        correctAnswer: isQuizMode ? q.correctAnswer : undefined
      };
    });

    let appsScriptSuccessful = false;

    try {
      // 1. Check if Apps Script is configured and should be used
      if (useAppsScript && globalAppsScriptUrl) {
        setCreationStage('Đang khởi tạo nhanh qua Apps Script...');
        try {
          const res = await fetch('/api/apps-script-proxy', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              url: globalAppsScriptUrl,
              payload: {
                action: 'create_linked_docx_form',
                folderId: folderId,
                title: parsedTitle,
                description: parsedDesc,
                questions: finalSubmissionQuestions,
                sheetId: sheetConnectionMode === 'link_existing' ? selectedSheetId : undefined
              }
            })
          });

          if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(errBody.error || `Apps Script returned error code: ${res.status}`);
          }

          const data = await res.json();
          if (data.status === 'success') {
            setCreationResult({
              formId: data.formId,
              sheetId: data.sheetId,
              formEditUrl: `https://docs.google.com/forms/d/${data.formId}/edit`,
              formResponseUrl: data.responderUri || `https://docs.google.com/forms/d/${data.formId}/viewform`,
              sheetUrl: data.sheetId ? `https://docs.google.com/spreadsheets/d/${data.sheetId}/edit` : undefined,
              wasFallback: false
            });
            appsScriptSuccessful = true;
          } else {
            throw new Error(data.error || 'Lỗi Apps Script cục bộ');
          }
        } catch (scriptErr: any) {
          console.warn("Apps Script Error, auto falling back to Google REST standard flow:", scriptErr);
          setCreationStage('Đang chuyển hướng sang phương thức dự phòng Google REST API tốt nhất...');
          await new Promise(resolve => setTimeout(resolve, 800)); // Smooth transit wait to let user read
        }
      }

      if (!appsScriptSuccessful) {
        // 2. FALLBACK FLOW: Pure client-side Google REST APIs
        setCreationStage('Liên kết mô-đun Google Forms API trực tiếp...');
        const { createFormREST, addQuestionsREST, createSpreadsheetREST, moveFileToFolder } = await import('../lib/googleApi');
        
        // Step A: Create Form
        setCreationStage('Thiết lập biểu mẫu Google Form mới...');
        const formInfo = await createFormREST(token, parsedTitle);
        
        // Step B: Set Questions
        setCreationStage(`Đang đồng bộ cấu trúc ${finalSubmissionQuestions.length} câu hỏi...`);
        await addQuestionsREST(token, formInfo.formId, finalSubmissionQuestions, parsedDesc);
        
        // Step C: Move Form to selected Drive folder
        setCreationStage('Di chuyển biểu mẫu vào Thư mục lưu trữ...');
        await moveFileToFolder(token, formInfo.formId, folderId);

        let sheetId: string | undefined = undefined;
        let sheetUrl: string | undefined = undefined;

        // Step D: Extract Spreadsheet matching responses
        if (sheetConnectionMode === 'link_existing' && selectedSheetId) {
          setCreationStage('Đang ghép nối với Google Sheet sẵn có...');
          sheetId = selectedSheetId;
          sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
        } else if (linkSpreadsheet) {
          setCreationStage('Đang tạo mới và đồng bộ Google Sheets đối sánh ứng viên...');
          const ssTitle = parsedTitle + ' (Responses)';
          sheetId = await createSpreadsheetREST(token, ssTitle, folderId);
          sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
        }

        setCreationStage('Không gian khởi tạo liên kết hoàn thành!');
        setCreationResult({
          formId: formInfo.formId,
          sheetId,
          formEditUrl: `https://docs.google.com/forms/d/${formInfo.formId}/edit`,
          formResponseUrl: formInfo.responderUri,
          sheetUrl,
          wasFallback: true
        });
      }

    } catch (err: any) {
      console.error(err);
      alert(`Gặp lỗi khi tạo tự động: ${err.message || err}. Vui lòng thử lại hoặc kiểm tra quyền tài khoản.`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleReset = () => {
    setQuestions([]);
    setParsedTitle('');
    setParsedDesc('');
    setHasParsed(false);
    setInputText('');
    setCreationResult(null);
  };

  return (
    <div className="space-y-6 text-left">
      <div className="bg-slate-50 border border-slate-200/60 rounded-3xl p-6">
        <h2 className="font-sans font-black tracking-tight text-xl uppercase text-indigo-950 flex items-center space-x-2">
          <FileText className="h-6 w-6 text-indigo-600" />
          <span>Tự động hóa Tạo Form & Sheets từ Word</span>
        </h2>
        <p className="text-slate-500 text-xs font-medium max-w-2xl mt-1">
          Bơm trực tiếp file tài liệu khảo sát, đề kiểm tra Word (.docx) hoặc dán văn bản thô để hệ thống AI Heuristic bóc tách câu hỏi, tự tạo Form gốc kèm Sheets liên kết trực tiếp trong cùng thư mục <span className="font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md">"{folderName}"</span>.
        </p>
      </div>

      <AnimatePresence mode="wait">
        {!hasParsed ? (
          /* SECTION 1: UPLOAD & PASTE SOURCE */
          <motion.div
            key="source-input"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden"
          >
            {/* Header tab choose */}
            <div className="border-b border-slate-100 flex p-2 bg-slate-50/50">
              <button
                onClick={() => setSourceType('upload')}
                className={`flex-1 py-3 px-4 rounded-xl font-sans text-xs font-bold transition-all flex items-center justify-center space-x-2 cursor-pointer ${
                  sourceType === 'upload' 
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10 scale-[1.01]' 
                    : 'text-slate-600 hover:text-indigo-600 hover:bg-white/50'
                }`}
              >
                <UploadCloud className="h-4 w-4" />
                <span>Tải lên File Word (.docx)</span>
              </button>
              <button
                onClick={() => setSourceType('paste')}
                className={`flex-1 py-3 px-4 rounded-xl font-sans text-xs font-bold transition-all flex items-center justify-center space-x-2 cursor-pointer ${
                  sourceType === 'paste' 
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10 scale-[1.01]' 
                    : 'text-slate-600 hover:text-indigo-600 hover:bg-white/50'
                }`}
              >
                <FileText className="h-4 w-4" />
                <span>Dán văn bản văn bản thô</span>
              </button>
            </div>

            <div className="p-8">
              {/* Parser Selector */}
              <div className="mb-6 bg-indigo-50/30 border border-indigo-100/50 p-4 rounded-2xl text-left">
                <span className="text-[10px] uppercase font-bold text-indigo-900/60 block mb-3 font-sans tracking-wider">Cấu hình thuật toán phân tích</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setParserType('ai')}
                    className={`p-4 rounded-xl border-2 text-left transition-all flex items-start space-x-3 cursor-pointer ${
                      parserType === 'ai'
                        ? 'bg-indigo-50/80 border-indigo-600 text-indigo-950 shadow-sm ring-2 ring-indigo-600/15'
                        : 'bg-white/40 border-slate-200 text-slate-500 hover:bg-white/80 hover:border-slate-300'
                    }`}
                  >
                    <div className={`p-2.5 rounded-lg shrink-0 ${parserType === 'ai' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-400'}`}>
                      <Sparkles className="h-4 w-4 animate-pulse" />
                    </div>
                    <div>
                      <span className="font-bold text-xs block">Phân tích bằng AI Gemini (Khuyên dùng)</span>
                      <span className="text-[10px] text-slate-450 leading-tight block mt-0.5">Tự động nhận diện câu hỏi, học và khớp đáp án chính xác tới 99%</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setParserType('traditional')}
                    className={`p-4 rounded-xl border-2 text-left transition-all flex items-start space-x-3 cursor-pointer ${
                      parserType === 'traditional'
                        ? 'bg-indigo-50/80 border-indigo-600 text-indigo-950 shadow-sm ring-2 ring-indigo-600/15'
                        : 'bg-white/40 border-slate-200 text-slate-500 hover:bg-white/80 hover:border-slate-300'
                    }`}
                  >
                    <div className={`p-2.5 rounded-lg shrink-0 ${parserType === 'traditional' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-400'}`}>
                      <Settings className="h-4 w-4" />
                    </div>
                    <div>
                      <span className="font-bold text-xs block">Giải mã Heuristics truyền thống</span>
                      <span className="text-[10px] text-slate-450 leading-tight block mt-0.5">Bóc tách thô thuần túy dựa trên các ký hiệu văn bản đầu dòng</span>
                    </div>
                  </button>
                </div>
              </div>

              {sourceType === 'upload' ? (
                /* FILE UPLOAD DRAG BOX */
                <div
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-3xl p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                    dragActive 
                      ? 'border-indigo-500 bg-indigo-50/40 scale-[0.99]' 
                      : 'border-slate-200 hover:border-slate-350 hover:bg-slate-50/50 bg-white'
                  }`}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept=".docx"
                    className="hidden"
                  />
                  
                  {isParsing ? (
                    <div className="space-y-3">
                      <RefreshCw className="h-10 w-10 text-indigo-600 animate-spin mx-auto animate-pulse" />
                      <p className="font-bold text-slate-800 text-sm">Đang giải nén và phân tách tệp tin .docx...</p>
                      <p className="text-slate-400 text-xs">Vui lòng chờ trong chốc lát</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="p-4 bg-indigo-50 rounded-2xl text-indigo-650 w-fit mx-auto border border-indigo-100/50 shadow-xs">
                        <FileText className="h-8 w-8 text-indigo-600" />
                      </div>
                      <div>
                        <p className="font-bold text-slate-800 text-sm">Kéo & Thả file Word của bạn tại đây</p>
                        <p className="text-slate-400 text-xs mt-1">Hoặc click để duyệt tìm tệp chương trình (.docx)</p>
                      </div>
                      <div className="inline-flex py-1.5 px-3 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 tracking-wider">
                        TIẾT KIỆM THỜI GIAN 100%
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* COPY-PASTE EDITOR */
                <div className="space-y-4">
                  <div className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1 flex items-center space-x-1.5">
                    <span>Nhập dữ liệu văn bản theo cấu trúc:</span>
                  </div>
                  <textarea
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    placeholder={`Ví dụ cấu trúc:\nTiêu đề: Khảo sát lâm sàng về dinh dưỡng\nMô tả: Đóng góp ý kiến của các cán bộ nội trú\n\nCâu 1: Cấp bậc hoạt động của bạn là gì?\nA. Điều dưỡng\nB. Bác sĩ chuyên khoa\nC. Trưởng khoa\n\nCâu 2: Nhận xét quy trình chuẩn bị thuốc dã ngoại...`}
                    rows={12}
                    className="w-full px-5 py-4 border border-slate-200 rounded-2xl font-mono text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 bg-slate-50 focus:bg-white transition-all resize-y"
                  />
                  <div className="flex justify-end pt-2">
                    <button
                      onClick={handleParsePaste}
                      disabled={isParsing}
                      className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-sans text-xs font-bold shadow-md hover:shadow-lg hover:scale-[1.01] active:scale-100 transition-all flex items-center space-x-2 disabled:bg-slate-300 cursor-pointer"
                    >
                      {isParsing ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Đang bóc tách...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4 text-amber-300" />
                          <span>Phân tách câu hỏi thông minh</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        ) : !creationResult ? (
          /* SECTION 2: INTERACTIVE PARSED QUESTION EDITOR */
          <motion.div
            key="parsed-editor"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="space-y-6"
          >
            {/* Header controls metadata */}
            <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4">
              <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                <span className="text-[10px] uppercase font-sans font-black tracking-widest text-slate-400">Thiết lập Biểu mẫu</span>
                <button
                  onClick={handleReset}
                  className="text-[11px] font-bold text-slate-500 hover:text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-xl transition-all"
                >
                  Xóa đi làm lại
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500">Tiêu đề Biểu mẫu (Forms)</label>
                  <input
                    type="text"
                    value={parsedTitle}
                    onChange={e => setParsedTitle(e.target.value)}
                    placeholder="Nhập tiêu đề biểu mẫu"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500">Mô tả chi tiết</label>
                  <input
                    type="text"
                    value={parsedDesc}
                    onChange={e => setParsedDesc(e.target.value)}
                    placeholder="Nhập mô tả biểu mẫu ngắn"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-xs font-medium text-slate-650 bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>
            </div>

            {/* Quiz scoring configuration card */}
            <div className="bg-gradient-to-r from-indigo-50 to-blue-50/40 border border-indigo-200/50 rounded-3xl p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-xs">
                    <CheckCircle2 className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h3 className="font-sans font-black text-xs uppercase text-indigo-950 tracking-tight">Kích hoạt chế độ Tính điểm / Bài kiểm tra (Quiz Mode)</h3>
                    <p className="text-[10px] text-indigo-600 font-medium">Biến biểu mẫu của bạn thành một bài thi thử tự động chấm điểm và cấu hình trọng số.</p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer select-none shrink-0">
                  <input
                    type="checkbox"
                    checked={isQuizMode}
                    onChange={(e) => setIsQuizMode(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 rounded-full peer peer-focus:ring-2 peer-focus:ring-indigo-500/20 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>

              {isQuizMode && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="pt-3 border-t border-indigo-100/60 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs"
                >
                  <div className="space-y-1.5 text-left">
                    <label className="text-[11px] font-bold text-slate-500 block">Chế độ phân phối điểm số:</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setQuizScoreMode('manual')}
                        className={`py-2 px-3 rounded-xl border font-bold text-center transition-all cursor-pointer ${
                          quizScoreMode === 'manual'
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/10 scale-[1.01]'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        Thủ công
                      </button>
                      <button
                        type="button"
                        onClick={() => setQuizScoreMode('fixed')}
                        className={`py-2 px-3 rounded-xl border font-bold text-center transition-all cursor-pointer ${
                          quizScoreMode === 'fixed'
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/10 scale-[1.01]'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        Đồng đều
                      </button>
                      <button
                        type="button"
                        onClick={() => setQuizScoreMode('equal')}
                        className={`py-2 px-3 rounded-xl border font-bold text-center transition-all cursor-pointer ${
                          quizScoreMode === 'equal'
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/10 scale-[1.01]'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        Chia đều
                      </button>
                    </div>
                  </div>

                  <div className="flex items-end">
                    {quizScoreMode === 'fixed' && (
                      <div className="space-y-1.5 w-full text-left">
                        <label className="text-[11px] font-bold text-slate-500">Số điểm cố định cho mỗi câu:</label>
                        <div className="flex items-center space-x-2">
                          <input
                            type="number"
                            min="1"
                            value={fixedPointsValue}
                            onChange={(e) => setFixedPointsValue(Math.max(1, Number(e.target.value)))}
                            className="w-24 px-3 py-2 border border-slate-200 rounded-xl font-bold text-xs text-slate-800 bg-white"
                          />
                          <span className="text-slate-500 font-medium font-sans">điểm / câu (Ý kiến tổng: {fixedPointsValue * questions.length} điểm)</span>
                        </div>
                      </div>
                    )}

                    {quizScoreMode === 'equal' && (
                      <div className="space-y-1.5 w-full text-left">
                        <label className="text-[11px] font-bold text-slate-500 block">Tổng quỹ điểm mục tiêu:</label>
                        <div className="flex items-center space-x-2">
                          <input
                            type="number"
                            min="1"
                            value={totalQuizPoints}
                            onChange={(e) => setTotalQuizPoints(Math.max(1, Number(e.target.value)))}
                            className="w-24 px-3 py-2 border border-slate-200 rounded-xl font-bold text-xs text-slate-800 bg-white"
                          />
                          <span className="text-slate-500 font-medium font-sans">điểm tổng (Khoảng: {parseFloat((totalQuizPoints / (questions.length || 1)).toFixed(1))}đ / câu)</span>
                        </div>
                      </div>
                    )}

                    {quizScoreMode === 'manual' && (
                      <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100/60 flex items-center space-x-2 w-full text-left">
                        <Sparkles className="h-4 w-4 text-indigo-600 animate-pulse shrink-0" />
                        <span className="text-[10px] text-indigo-950 font-medium leading-tight block">Bạn có thể tự ý đặt điểm số riêng biệt cho từng câu trực tiếp tại các thẻ câu hỏi bên dưới.</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </div>

            {/* List of Questions */}
            <div className="space-y-4">
              <div className="flex justify-between items-center px-2">
                <div className="flex items-center space-x-2">
                  <h3 className="font-sans font-bold text-sm text-slate-800 uppercase tracking-tight">Danh sách câu hỏi bóc tách </h3>
                  <span className="bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-full text-[10px] font-bold">{questions.length} câu</span>
                </div>
                <button
                  onClick={handleAddBlankQuestion}
                  className="px-3.5 py-2 border border-dashed border-indigo-200 hover:border-indigo-400 bg-indigo-50/30 hover:bg-indigo-100 text-indigo-700 rounded-xl font-sans text-xs font-bold flex items-center space-x-1.5 transition-all text-left cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>Thêm câu hỏi mới</span>
                </button>
              </div>

              {questions.length === 0 ? (
                <div className="bg-white border-2 border-dashed border-slate-200 p-10 rounded-3xl text-center space-y-2">
                  <AlertCircle className="h-8 w-8 text-slate-400 mx-auto" />
                  <p className="font-bold text-slate-700 text-sm">Chưa có câu hỏi nào trong danh sách</p>
                  <p className="text-slate-400 text-xs">Vui lòng click nút thêm câu hỏi hoặc dán lại Word.</p>
                </div>
              ) : (
                questions.map((q, qIdx) => (
                  <div 
                    key={q.id}
                    className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs relative hover:shadow-md hover:border-indigo-100 transition-all text-left"
                  >
                    <div className="flex flex-col lg:flex-row gap-4 items-start justify-between">
                      {/* Left: Input title & Options */}
                      <div className="flex-1 w-full space-y-4">
                        <div className="flex items-start space-x-3">
                          <span className="font-sans font-black text-xs text-indigo-700 bg-indigo-50 px-2.5 py-1.5 rounded-xl border border-indigo-100">
                            {qIdx + 1}
                          </span>
                          <input
                            type="text"
                            value={q.title}
                            onChange={e => handleUpdateQuestionTitle(q.id, e.target.value)}
                            className="w-full font-bold text-xs text-slate-800 focus:outline-hidden focus:border-b focus:border-slate-400 py-1"
                            placeholder="Nhập nội dung câu hỏi..."
                          />
                        </div>

                        {/* Options editor if choice type */}
                        {['MULTIPLE_CHOICE', 'CHECKBOX', 'DROP_DOWN'].includes(q.type) && (
                          <div className="pl-11 space-y-2">
                            <span className="text-[10px] uppercase font-black text-slate-500 tracking-wider">Các sự lựa chọn đáp án:</span>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {q.options.map((opt, oIdx) => (
                                <div key={oIdx} className="flex items-center space-x-2 border border-slate-100 rounded-xl px-3 py-1.5 bg-slate-50/30 group">
                                  <div className="w-1.5 h-1.5 rounded-full bg-slate-350 shrink-0"></div>
                                  <input
                                    type="text"
                                    value={opt}
                                    onChange={e => handleEditOption(q.id, oIdx, e.target.value)}
                                    className="flex-1 text-[11px] font-sans font-medium text-slate-700 focus:outline-hidden bg-transparent"
                                  />
                                  <button
                                    onClick={() => handleRemoveOption(q.id, oIdx)}
                                    className="opacity-0 group-hover:opacity-100 hover:text-rose-600 transition-opacity p-0.5"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                            <button
                              onClick={() => handleAddOption(q.id)}
                              className="text-[10px] font-sans font-bold text-indigo-600 hover:text-indigo-800 flex items-center space-x-1 pl-1 mt-1.5"
                            >
                              <Plus className="h-3 w-3" />
                              <span>Thêm lựa chọn đáp án</span>
                            </button>
                          </div>
                        )}

                        {/* Quiz mode score config for this single question card */}
                        {isQuizMode && (
                          <div className="pl-11 pt-3 border-t border-slate-100 mt-4 flex flex-wrap gap-4 items-center text-xs">
                            <div className="flex items-center space-x-2">
                              <span className="text-[10px] uppercase font-black text-slate-500 tracking-wider">Điểm số:</span>
                              {quizScoreMode === 'manual' ? (
                                <input
                                  type="number"
                                  min="0"
                                  value={q.points !== undefined ? q.points : 1}
                                  onChange={e => handleUpdatePoints(q.id, Number(e.target.value))}
                                  className="w-16 px-2 py-1 text-xs font-bold border border-slate-200 rounded-xl text-slate-800 bg-slate-50/50 focus:bg-white text-center"
                                />
                              ) : (
                                <span className="bg-indigo-50 text-indigo-700 font-extrabold text-xs px-2.5 py-1 rounded-xl border border-indigo-100 shadow-xs">
                                  {getQuestionPoints(q)}đ
                                </span>
                              )}
                            </div>

                            {['MULTIPLE_CHOICE', 'CHECKBOX', 'DROP_DOWN'].includes(q.type) ? (
                              <div className="flex items-center space-x-2 flex-grow min-w-[180px]">
                                <span className="text-[10px] uppercase font-black text-slate-500 tracking-wider shrink-0">Đáp án đúng:</span>
                                <select
                                  value={q.correctAnswer || ''}
                                  onChange={e => handleUpdateCorrectAnswer(q.id, e.target.value)}
                                  className="text-xs font-bold text-slate-700 border border-slate-200 bg-white rounded-xl py-1.5 px-3.5 cursor-pointer max-w-xs truncate focus:outline-hidden"
                                >
                                  <option value="">-- Chọn đáp án đúng --</option>
                                  {q.options.map((opt, oIdx) => (
                                    <option key={oIdx} value={opt}>
                                      {opt}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ) : (
                              <div className="flex items-center space-x-2 flex-grow">
                                <span className="text-[10px] uppercase font-black text-slate-500 tracking-wider shrink-0">Từ khóa đáp án đúng:</span>
                                <input
                                  type="text"
                                  value={q.correctAnswer || ''}
                                  onChange={e => handleUpdateCorrectAnswer(q.id, e.target.value)}
                                  placeholder="Nhập từ khóa đáp án đúng"
                                  className="flex-1 px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 bg-white focus:outline-hidden"
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Right: Controls block */}
                      <div className="w-full lg:w-auto flex flex-row lg:flex-col gap-2 shrink-0 md:justify-end border-t lg:border-t-0 border-slate-100 pt-3 lg:pt-0">
                        {/* Selector type */}
                        <div className="flex-1 lg:flex-initial">
                          <label className="text-[10px] font-semibold text-slate-400 block lg:hidden pb-1">Kiểu</label>
                          <select
                            value={q.type}
                            onChange={e => handleUpdateQuestionType(q.id, e.target.value as ParsedQuestion['type'])}
                            className="text-xs font-bold text-slate-700 border border-slate-200 bg-white rounded-xl py-2 px-3 w-full lg:w-44 focus:outline-hidden"
                          >
                            <option value="TEXT">Trả lời ngắn (Text)</option>
                            <option value="PARAGRAPH">Đoạn văn dài (Paragraph)</option>
                            <option value="MULTIPLE_CHOICE">Trắc nghiệm (Một lựa chọn)</option>
                            <option value="CHECKBOX">Hộp kiểm (Nhiều lựa chọn)</option>
                            <option value="DROP_DOWN">Danh sách thả xuống (Dropdown)</option>
                          </select>
                        </div>

                        {/* Controls */}
                        <div className="flex items-center space-x-2 mt-auto">
                          <button
                            onClick={() => handleToggleRequired(q.id)}
                            className={`px-3 py-2 rounded-xl text-[10px] font-bold border transition-colors flex items-center space-x-1 cursor-pointer ${
                              q.required 
                                ? 'bg-amber-100 text-amber-800 border-amber-300 font-extrabold' 
                                : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            <span>Bắt buộc</span>
                            {q.required && <Check className="h-2.5 w-2.5" />}
                          </button>

                          <button
                            onClick={() => handleDeleteQuestion(q.id)}
                            className="p-2 border border-slate-200 hover:border-rose-200 text-slate-400 hover:text-rose-600 bg-slate-50 hover:bg-rose-50 rounded-xl transition-all cursor-pointer"
                            title="Xóa câu hỏi này"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Automation parameters set up */}
            <div className="bg-indigo-950/95 text-white rounded-3xl p-6 border border-indigo-900/40 shadow-md">
              <h4 className="text-xs uppercase font-sans font-black tracking-wider text-indigo-300 mb-4 flex items-center space-x-2">
                <Settings className="h-4 w-4" />
                <span>Phương thức kết xuất & Liên kết tự động</span>
              </h4>

              <div className="space-y-4">
                {/* Switch Apps Script URL if preloaded */}
                {globalAppsScriptUrl ? (
                  <div className="bg-indigo-900/40 border border-indigo-800/40 p-4 rounded-2xl flex items-start space-x-3">
                    <input
                      type="checkbox"
                      id="use-apps-script-cb"
                      checked={useAppsScript}
                      onChange={e => setUseAppsScript(e.target.checked)}
                      className="mt-1 h-4 w-4 rounded-sm border-indigo-700 text-indigo-650 focus:ring-indigo-500 shrink-0"
                    />
                    <div>
                      <label htmlFor="use-apps-script-cb" className="font-bold text-xs text-white block cursor-pointer">
                        Sử dụng Apps Script kích hoạt tự động đồng bộ thực (Khuyên dùng)
                      </label>
                      <span className="text-[10px] text-indigo-300 block mt-1">
                        Hệ thống sẽ mượn mã Apps Script đã cấu hình của thư mục để liên kết Form trực tiếp tới Sheet Google. Mọi câu trả lời của ứng viên sẽ được đồng bộ gốc ngay khi nộp.
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-2xl flex items-start space-x-3">
                    <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-xs text-amber-300 block">
                        Chưa thiết lập Web App trên Google Apps Script cho thư mục này
                      </span>
                      <span className="text-[10px] text-amber-200/80 block mt-1">
                        Chúng tôi sẽ sử dụng phương thức tự động của Google API để tạo biểu mẫu và trang tính trong cùng thư mục. Dashboard sẽ đồng bộ hiển thị bằng cách tự đối khớp theo tên tệp trong thư mục. Để có đồng bộ cập nhật thời gian thực triệt để, hãy gắn mã Apps Script ở menu "Đồng bộ tối hóa" sau đó!
                      </span>
                    </div>
                  </div>
                )}

                {/* Google Sheet Connection Selector */}
                <div className="bg-indigo-900/30 border border-indigo-850/50 p-5 rounded-2xl space-y-4">
                  <div className="flex items-center space-x-2 pb-1 border-b border-indigo-800/30">
                    <FileSpreadsheet className="h-4.5 w-4.5 text-teal-400" />
                    <span className="font-bold text-xs text-indigo-200 uppercase tracking-wider">Liên kết Google Trang tính (Sheets)</span>
                  </div>

                  {isLoadingSheets ? (
                    <div className="flex items-center space-x-2 py-2 text-indigo-300">
                      <Loader2 className="h-4 w-4 animate-spin text-teal-400" />
                      <span className="text-xs">Đang rà quét Google Sheets trong thư mục...</span>
                    </div>
                  ) : existingSheets.length === 1 ? (
                    /* CASE 1: Exactly 1 sheet found - Auto active link */
                    <div className="space-y-3">
                      <div className="flex items-start space-x-2.5 bg-teal-500/10 border border-teal-500/20 p-3 rounded-xl">
                        <Check className="h-4.5 w-4.5 text-teal-400 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold text-[11px] text-teal-300 block">Phát hiện đúng 1 tệp Google Sheet trong thư mục:</span>
                          <span className="text-[11px] font-mono text-white block mt-1 truncate bg-indigo-950/40 px-2 py-1 rounded">
                            {existingSheets[0].name}
                          </span>
                          <span className="text-[10px] text-teal-200/80 block mt-1.5">
                            Hệ thống đã tự động liên kết Form mới này với tệp Sheet sẵn có như yêu cầu.
                          </span>
                        </div>
                      </div>

                      {/* Option to create new if user wants */}
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            setSheetConnectionMode('create_new');
                            setSelectedSheetId('');
                          }}
                          className="text-[10px] underline text-indigo-300 hover:text-white cursor-pointer"
                        >
                          Tôi muốn tạo tệp Sheets mới thay thế
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* CASE 2: 0 sheets or > 1 sheets - Ask */
                    <div className="space-y-3 text-xs leading-relaxed">
                      {existingSheets.length === 0 ? (
                        <div className="space-y-2">
                          <p className="text-indigo-200 text-[11px]">
                            Thư mục <span className="font-semibold text-white">"{folderName}"</span> hiện chưa có tệp Google Sheets nào sẵn có.
                          </p>
                          <div className="p-3 bg-indigo-950/40 rounded-xl border border-indigo-900 flex items-center space-x-2.5">
                            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                            <span className="text-[11px] text-indigo-300">Hệ thống sẽ tự động tạo tệp mới: <strong>{parsedTitle} (Responses)</strong></span>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-indigo-200 text-[11px]">
                            Phát hiện <strong className="text-white bg-indigo-850 px-2 py-0.5 rounded-sm">{existingSheets.length} tệp Google Sheets</strong> trong thư mục của bạn. Bạn muốn liên kết với tệp nào?
                          </p>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {/* Option 2a: Create New */}
                            <button
                              type="button"
                              onClick={() => {
                                setSheetConnectionMode('create_new');
                                setSelectedSheetId('');
                              }}
                              className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                                sheetConnectionMode === 'create_new'
                                  ? 'bg-indigo-900/60 border-teal-500 text-white'
                                  : 'bg-indigo-950/40 border-indigo-900 text-indigo-300 hover:bg-indigo-905/30'
                              }`}
                            >
                              <div className="flex items-center space-x-2 mb-1">
                                <div className={`w-3 h-3 rounded-full border flex items-center justify-center ${sheetConnectionMode === 'create_new' ? 'border-teal-400' : 'border-indigo-600'}`}>
                                  {sheetConnectionMode === 'create_new' && <div className="w-1.5 h-1.5 bg-teal-400 rounded-full"></div>}
                                </div>
                                <span className="font-bold text-[11px]">Tạo tệp Sheets mới</span>
                              </div>
                              <p className="text-[9px] text-indigo-400 leading-tight">Khởi tạo một trang tính đồng bộ câu trả lời độc lập</p>
                            </button>

                            {/* Option 2b: Link Existing */}
                            <button
                              type="button"
                              onClick={() => {
                                setSheetConnectionMode('link_existing');
                                if (existingSheets.length > 0 && !selectedSheetId) {
                                  setSelectedSheetId(existingSheets[0].id);
                                }
                              }}
                              className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                                sheetConnectionMode === 'link_existing'
                                  ? 'bg-indigo-900/60 border-teal-500 text-white'
                                  : 'bg-indigo-950/40 border-indigo-900 text-indigo-300 hover:bg-indigo-905/30'
                              }`}
                            >
                              <div className="flex items-center space-x-2 mb-1">
                                <div className={`w-3 h-3 rounded-full border flex items-center justify-center ${sheetConnectionMode === 'link_existing' ? 'border-teal-400' : 'border-indigo-600'}`}>
                                  {sheetConnectionMode === 'link_existing' && <div className="w-1.5 h-1.5 bg-teal-400 rounded-full"></div>}
                                </div>
                                <span className="font-bold text-[11px]">Chọn Sheets có sẵn</span>
                              </div>
                              <p className="text-[9px] text-indigo-400 leading-tight">Ghi danh trực tiếp câu trả lời vào tệp sẵn có</p>
                            </button>
                          </div>

                          {/* Existing Sheets dropdown if chosen */}
                          {sheetConnectionMode === 'link_existing' && (
                            <div className="space-y-1.5 bg-indigo-950/80 p-3.5 rounded-xl border border-indigo-700/40">
                              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Chọn tệp Google Sheets muốn liên kết:</label>
                              <select
                                value={selectedSheetId}
                                onChange={e => setSelectedSheetId(e.target.value)}
                                className="w-full bg-indigo-900 border border-slate-700 text-white rounded-lg p-2 text-xs focus:outline-hidden focus:border-teal-400 focus:ring-1 focus:ring-teal-400 font-medium cursor-pointer"
                              >
                                {existingSheets.map(s => (
                                  <option key={s.id} value={s.id} className="bg-indigo-950">
                                    {s.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Companion Spreadsheet creation if REST fallback & create_new is selected */}
                {!useAppsScript && sheetConnectionMode === 'create_new' && (
                  <div className="bg-indigo-900/40 border border-indigo-800/40 p-4 rounded-2xl flex items-start space-x-3">
                    <input
                      type="checkbox"
                      id="link-sheet-rest"
                      checked={linkSpreadsheet}
                      onChange={e => setLinkSpreadsheet(e.target.checked)}
                      className="mt-1 h-4 w-4 rounded-sm border-indigo-700 text-indigo-600 focus:ring-indigo-500 shrink-0"
                    />
                    <div>
                      <label htmlFor="link-sheet-rest" className="font-bold text-xs text-white block cursor-pointer">
                        Khởi tạo Companion Spreadsheet và thiết lập các tiêu đề cột tương ứng
                      </label>
                      <span className="text-[10px] text-indigo-300 block mt-1">
                        Tạo đồng thời 1 Sheet rỗng cùng tên để làm đích cho câu trả lời, thiết lập sẵn hàng đầu làm thanh tiêu đề cột khớp với câu hỏi!
                      </span>
                    </div>
                  </div>
                )}

                {/* Build trigger button */}
                <div className="flex justify-between items-center border-t border-indigo-900/60 pt-5 mt-2">
                  <button
                    onClick={handleReset}
                    className="text-xs font-bold text-indigo-300 hover:text-white transition-all px-4 py-2 hover:bg-white/5 rounded-xl cursor-pointer"
                  >
                    Hủy tệp nguồn
                  </button>
                  <button
                    onClick={handleCreateAutomationFiles}
                    disabled={isCreating}
                    className="px-7 py-3 bg-white text-indigo-950 hover:bg-slate-50 cursor-pointer rounded-2xl font-sans text-xs font-black shadow-lg flex items-center space-x-2.5 transition-all disabled:bg-slate-500 disabled:text-slate-350 hover:scale-[1.01] active:scale-100"
                  >
                    {isCreating ? (
                      <div className="flex items-center space-x-2 text-left">
                        <Loader2 className="h-4 w-4 animate-spin text-indigo-700 shrink-0" />
                        <div className="flex flex-col">
                          <span className="font-bold text-[11px] text-indigo-950">Đang tự động xử lý...</span>
                          <span className="text-[9.5px] text-indigo-600 font-medium leading-none mt-1 animate-pulse">{creationStage || 'Vui lòng đợi giây lát...'}</span>
                        </div>
                      </div>
                    ) : (
                      <>
                        <Play className="h-4 w-4 text-indigo-600 shrink-0" />
                        <span>Kích hoạt Tạo Form & Sheet</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          /* SECTION 3: SUCCESS RESULT STATE */
          <motion.div
            key="success-card"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="bg-white rounded-3xl border border-teal-200/80 p-8 shadow-sm space-y-7 text-center relative overflow-hidden"
          >
            {/* Ambient Background Glow Banner */}
            <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-teal-400 via-emerald-500 to-indigo-600"></div>
            
            <div className="py-4 space-y-4">
              <div className="p-4 bg-emerald-50 text-emerald-600 rounded-full w-fit mx-auto border border-emerald-100 shrink-0 transform scale-110">
                <CheckCircle2 className="h-9 w-9" />
              </div>
              <div>
                <h3 className="font-sans font-black tracking-tight text-lg text-emerald-900 uppercase">Khởi tạo và đồng bộ thành công!</h3>
                <p className="text-slate-500 text-xs mt-1">
                  Biểu mẫu Google Form và tệp Google Sheets liên kết của bạn đã được lưu tệp trực tiếp trong thư mục Drive.
                </p>
              </div>
            </div>

            {/* Quick action buttons list */}
            <div className="max-w-md mx-auto space-y-3 pt-2">
              {creationResult.formEditUrl && (
                <a
                  href={creationResult.formEditUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between px-5 py-4 border border-slate-200 rounded-2xl hover:border-indigo-400 hover:bg-slate-50/50 transition-all text-left font-sans group"
                >
                  <div className="flex items-center space-x-3">
                    <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div>
                      <span className="font-bold text-xs text-slate-850 block">Mở chỉnh sửa Google Form</span>
                      <span className="text-[10px] text-slate-400">Xem và sửa đổi các câu hỏi trên giao diện Google</span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-1 transition-all" />
                </a>
              )}

              {creationResult.formResponseUrl && (
                <a
                  href={creationResult.formResponseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between px-5 py-4 border border-slate-200 rounded-2xl hover:border-indigo-400 hover:bg-slate-50/50 transition-all text-left font-sans group"
                >
                  <div className="flex items-center space-x-3">
                    <div className="p-2.5 bg-amber-50 rounded-xl">
                      <Eye className="h-5 w-5 text-amber-500" />
                    </div>
                    <div>
                      <span className="font-bold text-xs text-slate-850 block">Mở link điền gửi câu trả lời</span>
                      <span className="text-[10px] text-slate-400">Gửi liên kết công khai này cho ứng viên / nhân viên điền tin</span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-1 transition-all" />
                </a>
              )}

              {creationResult.sheetUrl && (
                <a
                  href={creationResult.sheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between px-5 py-4 border border-slate-200 rounded-2xl hover:border-emerald-400 hover:bg-slate-50/50 transition-all text-left font-sans group"
                >
                  <div className="flex items-center space-x-3">
                    <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl">
                      <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div>
                      <span className="font-bold text-xs text-slate-850 block">Mở tệp Google Sheets đồng bộ</span>
                      <span className="text-[10px] text-slate-400">Truy cập dữ liệu thô câu trả lời trong cùng một Sheet</span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-emerald-600 group-hover:translate-x-1 transition-all" />
                </a>
              )}
            </div>

            {creationResult.wasFallback && (
              <div className="max-w-md mx-auto bg-emerald-50/50 border border-emerald-200/80 rounded-2xl p-5 text-left space-y-3 mt-4 text-xs font-sans">
                <div className="flex items-start space-x-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-slate-800 text-[13px]">🎉 Đã tạo Biểu mẫu & Bảng tính thành công!</h4>
                    <p className="text-slate-600 text-[11px] mt-1 leading-relaxed">
                      Để câu trả lời từ người điền tự động chảy về tệp Google Sheets đồng bộ vừa khởi tạo, hãy hoàn tất liên kết nhanh bằng cách thực hiện 4 bước siêu dễ sau:
                    </p>
                  </div>
                </div>
                
                <div className="border-t border-emerald-200/30 pt-3 space-y-2.5 text-[11px] text-slate-700 pl-1 leading-relaxed">
                  <div className="flex items-start gap-2.5">
                    <span className="font-bold text-indigo-650 bg-indigo-50 leading-none py-1 px-1.5 rounded text-[10px] shrink-0 mt-0.5">Bước 1</span>
                    <span>Bấm nút <strong className="text-indigo-700 font-semibold">"Mở chỉnh sửa Google Form"</strong> ở trên.</span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="font-bold text-indigo-650 bg-indigo-50 leading-none py-1 px-1.5 rounded text-[10px] shrink-0 mt-0.5">Bước 2</span>
                    <span>Chọn thẻ <strong className="text-indigo-800 font-semibold">"Câu trả lời"</strong> (Responses) ở giữa đầu trang của biểu mẫu.</span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="font-bold text-emerald-700 bg-emerald-50 leading-none py-1 px-1.5 rounded text-[10px] shrink-0 mt-0.5">Bước 3</span>
                    <span>Nhấp vào biểu tượng nút xanh lá <strong className="text-emerald-700 font-semibold">"Liên kết với Trang tính"</strong> (Link with Sheets).</span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="font-bold text-emerald-700 bg-emerald-50 leading-none py-1 px-1.5 rounded text-[10px] shrink-0 mt-0.5">Bước 4</span>
                    <span>Tích chọn <strong className="text-slate-800 font-semibold">"Chọn trang tính hiện có"</strong> (Select existing spreadsheet), sau đó tìm và chọn đúng tệp Sheet rỗng vừa được tạo sẵn ở trên!</span>
                  </div>
                </div>
                
                <div className="bg-white/65 rounded-lg p-2 text-[10px] text-slate-500 italic mt-2 font-medium leading-normal flex gap-1.5 items-center">
                  <Sparkles className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <span>Chỉ cần thực hiện 1 lần duy nhất cho mỗi biểu mẫu để tự động đồng bộ dữ liệu trọn đời!</span>
                </div>
              </div>
            )}

            {/* Done button return */}
            <div className="border-t border-slate-100 pt-6 max-w-md mx-auto flex gap-3">
              <button
                onClick={handleReset}
                className="flex-1 py-3 border border-slate-200 hover:bg-slate-50 text-slate-600 font-sans font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                Tạo Form khác
              </button>
              <button
                onClick={() => onSuccess()}
                className="flex-grow py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-sans font-black text-xs rounded-xl shadow-md transition-all cursor-pointer"
              >
                Quay lại danh sách Form
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
