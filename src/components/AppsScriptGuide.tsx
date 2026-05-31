/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Clipboard, Check, HelpCircle, Activity, FileCode, Calendar, Globe, Save, AlertCircle, Loader2 } from 'lucide-react';

interface AppsScriptGuideProps {
  folderId: string;
  folderName: string;
  globalAppsScriptUrl: string;
  setGlobalAppsScriptUrl: (url: string) => void;
  onSaveGlobalAppsScript: () => void;
  isSavingGlobalAppsScript: boolean;
}

export default function AppsScriptGuide({ 
  folderId, 
  folderName,
  globalAppsScriptUrl,
  setGlobalAppsScriptUrl,
  onSaveGlobalAppsScript,
  isSavingGlobalAppsScript
}: AppsScriptGuideProps) {
  const [copied, setCopied] = useState(false);

  // Generate perfect robust Apps Script code configured with folderId
  const appsScriptCode = `/**
 * GOOGLE FORMS MANAGER - REAL-TIME AUTOMATION & SECURITY ENGINE 
 * Thư mục liên kết: "${folderName}"
 * ID thư mục: "${folderId}"
 */

const FOLDER_ID = "${folderId}";
const CONFIG_FILE_NAME = ".gform_manager_settings.json";

/**
 * Trigger tự động chạy mỗi khi có phản hồi mới từ Google Forms
 */
function onFormSubmitTrigger(e) {
  try {
    const sheet = e ? e.range.getSheet() : SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const formUrl = sheet.getFormUrl();
    if (!formUrl) {
      Logger.log("Không tìm thấy Google Form liên kết với trang tính: " + sheet.getName());
      return;
    }
    const form = FormApp.openByUrl(formUrl);
    const formId = form.getId();
    
    // 1. Đọc tệp cấu hình từ thư mục Google Drive
    const config = getFolderConfig();
    if (!config || !config[formId]) {
      Logger.log("Không tìm thấy cấu hình cho Form ID: " + formId);
      return;
    }
    
    const settings = config[formId];
    const responses = form.getResponses();
    const lastResponse = responses[responses.length - 1];
    
    if (!lastResponse) return;
    
    const responseId = lastResponse.getId();
    const respondentEmail = lastResponse.getRespondentEmail() || "";
    const timestamp = lastResponse.getTimestamp();
    
    // 2. Kiểm tra danh sách Whitelist Email / Domain
    if (settings.enableEmailWhitelist && settings.emailWhitelist) {
      const whitelist = settings.emailWhitelist.split(",").map(item => item.trim().toLowerCase());
      let isAllowed = false;
      
      if (respondentEmail) {
        for (let rule of whitelist) {
          if (rule.startsWith("@") && respondentEmail.endsWith(rule)) {
            isAllowed = true;
            break;
          } else if (respondentEmail === rule) {
            isAllowed = true;
            break;
          }
        }
      }
      
      if (!isAllowed) {
        // Xóa phản hồi không thuộc whitelist tận gốc
        deleteResponseFromFormAndSheet(form, sheet, responseId, e);
        sendAlertEmail(respondentEmail || "Ẩn danh", "Từ chối do tài khoản không thuộc danh sách được quyền phản hồi.");
        return;
      }
    }
    
    // 3. Kiểm tra Giới hạn số lượng phản hồi tối đa (Max Responses)
    if (settings.enableMaxResponses) {
      const maxRes = Number(settings.maxResponses);
      const currentCount = responses.length;
      
      if (currentCount >= maxRes) {
        // Tắt nhận phản hồi của form
        form.setAcceptingResponses(false);
        sendAlertEmail("Hệ thống", "Form đã tự động ĐÓNG vì chạm ngưỡng số lượng phản hồi tối đa: " + maxRes);
        
        if (currentCount > maxRes) {
          // Xóa phản hồi vượt luồng
          deleteResponseFromFormAndSheet(form, sheet, responseId, e);
          return;
        }
      }
    }
    
    // 4. Kiểm tra giới hạn Thời gian Nhận phản hồi (Cấu hình tự động đồng bộ thời hạn)
    if (settings.enableTimeLimit) {
      const now = new Date();
      const startTime = settings.startTime ? new Date(settings.startTime) : null;
      const endTime = settings.endTime ? new Date(settings.endTime) : null;
      
      let expired = false;
      let notStarted = false;
      
      if (startTime && now < startTime) {
        notStarted = true;
      }
      if (endTime && now > endTime) {
        expired = true;
      }
      
      if (notStarted || expired) {
        deleteResponseFromFormAndSheet(form, sheet, responseId, e);
        if (expired) {
          form.setAcceptingResponses(false);
          sendAlertEmail("Hệ thống", "Biểu mẫu đã tự động đóng vì quá thời hạn nhận phản hồi.");
        }
        return;
      }
    }
    
    // Gửi thông báo email thời gian thực cho Admin khi một biểu mẫu được nộp thành công
    sendNewResponseNotification(form.getTitle(), respondentEmail || "Ẩn danh", timestamp);
    
  } catch (error) {
    Logger.log("Lỗi xử lý onFormSubmit: " + error.toString());
  }
}

/**
 * Đọc File Cấu Hình .gform_manager_settings.json trên Google Drive
 */
function getFolderConfig() {
  try {
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const files = folder.getFilesByName(CONFIG_FILE_NAME);
    if (files.hasNext()) {
      const file = files.next();
      const content = file.getAs("application/json").getDataAsString();
      return JSON.parse(content);
    }
  } catch (e) {
    Logger.log("Lỗi đọc file cấu hình: " + e.toString());
  }
  return null;
}

/**
 * Xóa phản hồi tận gốc khỏi biểu mẫu Form và dòng tương ứng trong trang tính Google Sheets
 */
function deleteResponseFromFormAndSheet(form, sheet, responseId, e) {
  try {
    // 1. Xóa phản hồi trên Google Form
    form.deleteResponse(responseId);
    Logger.log("Đã xóa phản hồi " + responseId + " trên Google Form");
    
    // 2. Tìm và xóa dòng trên Spreadsheet
    if (e && e.range) {
      const rowNum = e.range.getRow();
      sheet.deleteRow(rowNum);
      Logger.log("Đã xóa dòng " + rowNum + " khớp với sự kiện kích hoạt");
    } else {
      const data = sheet.getDataRange().getValues();
      for (let i = data.length - 1; i >= 1; i--) {
        // Đoán xem dòng nào khớp: dòng vừa thêm thường là dòng cuối cùng
        if (i === data.length - 1) {
          sheet.deleteRow(i + 1);
          Logger.log("Đã xóa dòng cuối cùng vừa thêm khỏi Google Sheet do thiếu tham số e");
          break;
        }
      }
    }
  } catch (e) {
    Logger.log("Lỗi khi thực hiện xóa triệt để: " + e.toString());
  }
}

/**
 * Gửi email thông báo cho Admin khi có phản hồi mới hợp lệ
 */
function sendNewResponseNotification(formTitle, email, timestamp) {
  const adminEmail = Session.getActiveUser().getEmail();
  const subject = "📝 [Google Forms Manager] Phản hồi mới từ Form: " + formTitle;
  const body = "Xin chào,\\n\\nBiểu mẫu \\"" + formTitle + "\\" vừa nhận được câu trả lời mới hợp lệ.\\n\\n" +
               "- Người nộp: " + email + "\\n" +
               "- Thời gian: " + timestamp + "\\n\\n" +
               "Xem phản hồi chi tiết tại bảng điều khiển của bạn.\\nTrân trọng!";
  
  if (adminEmail) {
    GmailApp.sendEmail(adminEmail, subject, body);
  }
}

/**
 * Gửi thông báo Gmail cảnh báo quy tắc vi phạm
 */
function sendAlertEmail(recipient, reason) {
  const adminEmail = Session.getActiveUser().getEmail();
  const subject = "⚠️ [Google Forms Manager] Cập nhật / Vi phạm cài đặt";
  const body = "Xin chào,\\n\\nHệ thống đã phát hiện hoạt động nộp biểu mẫu không hợp lệ hoặc kích hoạt đóng tự động:\\n\\n" +
               "- Người gửi/Đối tượng: " + recipient + "\\n" +
               "- Lý do hành động: " + reason + "\\n" +
               "- Biện pháp: Dữ liệu phản hồi đó đã bị tự động hủy bỏ và xóa sạch khỏi biểu mẫu để đảm bảo sự nhất quán.\\n\\n" +
               "Xin hãy kiểm tra bảng điều khiển để cập nhật thông tin cài đặt mới nhất.\\nTrân trọng!";
  
  if (adminEmail) {
    GmailApp.sendEmail(adminEmail, subject, body);
  }
}

/**
 * API Web Service hỗ trợ giao diện Web quản lý Google Forms từ xa
 */
function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents);
    const action = params.action;
    const formId = params.formId;
    
    if (action === "delete_response" && formId && params.responseId) {
      const form = FormApp.openByUrl(formId); // Or ById
      form.deleteResponse(params.responseId);
      
      return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Đã xóa thành công trong Form!" }))
                           .setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === "delete_all_responses" && formId) {
      const form = FormApp.openByUrl(formId); // Or ById
      form.deleteAllResponses();
      
      return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Đã xóa toàn bộ phản hồi trong Form thành công!" }))
                           .setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === "toggle_accepting" && formId) {
      const form = FormApp.openById(formId);
      const isAccepting = params.isAccepting === true;
      form.setAcceptingResponses(isAccepting);
      
      return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Cập nhật trạng thái nhận phản hồi: " + isAccepting }))
                           .setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === "create_linked_docx_form" && params.folderId && params.title) {
      const folder = DriveApp.getFolderById(params.folderId);
      
      // 1. Tạo Google Form mới
      const form = FormApp.create(params.title);
      if (params.description) {
        form.setDescription(params.description);
      }
      
      // 2. Tìm hoặc Tạo Google Sheet để nhận câu trả lời
      var ss;
      var isNewSheet = true;
      if (params.sheetId) {
        ss = SpreadsheetApp.openById(params.sheetId);
        isNewSheet = false;
      } else {
        ss = SpreadsheetApp.create(params.title + " (Responses)");
      }
      
      // 3. Liên kết Form trực tiếp vào tệp Sheet đồng bộ
      form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
      
      // 4. Di chuyển các tệp tin mới tạo vào thư mục đã cấu hình
      const formFile = DriveApp.getFileById(form.getId());
      folder.addFile(formFile);
      
      if (isNewSheet) {
        const ssFile = DriveApp.getFileById(ss.getId());
        folder.addFile(ssFile);
        
        // Xóa liên kết tạm của Sheet tại Root Drive
        try {
          DriveApp.getRootFolder().removeFile(ssFile);
        } catch (ex) {}
      }
      
      // Xóa liên kết tạm của Form tại Root Drive
      try {
        DriveApp.getRootFolder().removeFile(formFile);
      } catch (ex) {}
      
      // 5. Thêm tất cả câu hỏi bóc tách vào Form
      const questions = params.questions || [];
      var hasQuiz = false;
      for (var i = 0; i < questions.length; i++) {
        if (questions[i].points && questions[i].points > 0) {
          hasQuiz = true;
          break;
        }
      }
      if (hasQuiz) {
        form.setIsQuiz(true);
      }

      for (var i = 0; i < questions.length; i++) {
        var q = questions[i];
        var item;
        if (q.type === "MULTIPLE_CHOICE") {
          item = form.addMultipleChoiceItem();
          item.setTitle(q.title);
          if (q.options && q.options.length > 0) {
            item.setChoices(q.options.map(function(opt) { 
              var isCorrect = (q.correctAnswer === opt);
              return item.createChoice(opt, isCorrect); 
            }));
          }
          item.setRequired(q.required === true);
          if (q.points && q.points > 0) {
            item.setPoints(q.points);
          }
        } else if (q.type === "CHECKBOX") {
          item = form.addCheckboxItem();
          item.setTitle(q.title);
          if (q.options && q.options.length > 0) {
            item.setChoices(q.options.map(function(opt) { 
              var isCorrect = (q.correctAnswer === opt);
              return item.createChoice(opt, isCorrect); 
            }));
          }
          item.setRequired(q.required === true);
          if (q.points && q.points > 0) {
            item.setPoints(q.points);
          }
        } else if (q.type === "DROP_DOWN") {
          item = form.addListItem();
          item.setTitle(q.title);
          if (q.options && q.options.length > 0) {
            item.setChoices(q.options.map(function(opt) { 
              var isCorrect = (q.correctAnswer === opt);
              return item.createChoice(opt, isCorrect); 
            }));
          }
          item.setRequired(q.required === true);
          if (q.points && q.points > 0) {
            item.setPoints(q.points);
          }
        } else if (q.type === "PARAGRAPH") {
          item = form.addParagraphTextItem();
          item.setTitle(q.title);
          item.setRequired(q.required === true);
          if (q.points && q.points > 0) {
            item.setPoints(q.points);
          }
        } else {
          item = form.addTextItem();
          item.setTitle(q.title);
          item.setRequired(q.required === true);
          if (q.points && q.points > 0) {
            item.setPoints(q.points);
          }
        }
      }
      
      return ContentService.createTextOutput(JSON.stringify({ 
        status: "success", 
        formId: form.getId(), 
        sheetId: ss.getId(),
        responderUri: form.getPublishedUrl()
      })).setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", error: err.toString() }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}
`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(appsScriptCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div id="apps-script-guide" className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden mb-8 text-left">
      {/* Header Banner */}
      <div className="bg-[#1e1b4b] border-b border-indigo-900 px-6 py-5 text-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="p-2.5 bg-indigo-950 rounded-xl text-indigo-400">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-sans font-black tracking-tight text-base uppercase">Đồng bộ tự hóa Apps Script</h3>
            <p className="text-[11px] text-indigo-300 font-medium">Bơm mã tùy chỉnh vào liên kết Google Drive để kích hoạt kiểm soát bảo mật thời gian thực</p>
          </div>
        </div>
        <div className="shrink-0">
          {globalAppsScriptUrl ? (
            <span className="inline-flex items-center px-3.5 py-1.5 rounded-full text-[10px] font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-sans tracking-wide uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-2"></span>
              Đã đồng bộ Form gốc
            </span>
          ) : (
            <span className="inline-flex items-center px-3.5 py-1.5 rounded-full text-[10px] font-black bg-amber-500/10 text-amber-400 border border-amber-500/20 font-sans tracking-wide uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mr-2"></span>
              Chờ liên kết Web App
            </span>
          )}
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Global Apps Script Connection Section */}
        <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-5 space-y-4">
          <div className="flex items-start space-x-3 text-left">
            <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl border border-indigo-100 shrink-0">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <h4 className="font-sans font-black text-xs text-slate-800 tracking-wider uppercase">Liên kết MÃ Google Apps Script Web App</h4>
              <p className="text-[11px] text-slate-500 mt-1 max-w-2xl leading-normal font-medium">
                Dán địa chỉ <strong className="font-semibold text-slate-700">Mã ứng dụng Web (Web App URL)</strong> sau khi đã xuất bản triển khai (Deploy as Web App) trong Apps Script. Địa chỉ này sẽ được liên kết chung để hỗ trợ ứng dụng gỡ, xóa tận gốc các phản hồi sai lỗi trực tiếp từ xa trên Google Forms của toàn bộ các biểu mẫu trong thư mục này.
              </p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            <div className="md:col-span-10">
              <input
                type="url"
                placeholder="https://script.google.com/macros/s/.../exec"
                value={globalAppsScriptUrl}
                onChange={(e) => setGlobalAppsScriptUrl(e.target.value)}
                className="w-full text-xs border border-slate-200 rounded-xl px-4 py-3 bg-white focus:ring-4 focus:ring-indigo-100 outline-none transition-all text-slate-800 font-semibold font-mono placeholder:font-normal placeholder:font-sans"
              />
            </div>
            <div className="md:col-span-2">
              <button
                onClick={onSaveGlobalAppsScript}
                disabled={isSavingGlobalAppsScript}
                className="w-full h-full flex items-center justify-center space-x-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl py-3 text-xs font-bold active:scale-98 transition-all cursor-pointer shadow-md shadow-indigo-100"
              >
                {isSavingGlobalAppsScript ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Đang lưu...</span>
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    <span>Lưu liên kết</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {!globalAppsScriptUrl ? (
            <div className="flex items-start space-x-2 text-[10px] text-amber-700 bg-amber-50/70 rounded-xl border border-amber-100/40 p-3 mt-1.5">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
              <p className="leading-relaxed">
                Chưa có liên kết Apps Script Web App chung. Thao tác xóa câu hỏi phản hồi <strong className="font-semibold">chỉ diễn ra tạm thời trên Google Sheets</strong>. Để đồng bộ xóa triệt để tại Google Forms gốc, vui lòng dán URL và lưu lại.
              </p>
            </div>
          ) : (
            <div className="flex items-start space-x-2 text-[10px] text-emerald-700 bg-emerald-50/50 rounded-xl border border-emerald-100/40 p-3 mt-1.5">
              <Check className="h-4 w-4 shrink-0 mt-0.5 text-emerald-500" />
              <p className="leading-relaxed">
                Đã liên kết Apps Script Web App chung thành công! Thao tác xóa từ ứng dụng sẽ tự động gỡ sạch phản hồi trên cả Google Sheets và Google Forms.
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Instructions Column */}
          <div className="md:col-span-5 space-y-4">
            <h4 className="font-sans font-black text-xs text-slate-800 tracking-wider uppercase flex items-center space-x-2">
              <FileCode className="h-4.5 w-4.5 text-indigo-500" />
              <span>Quy trình cài đặt 3 bước đơn giản</span>
            </h4>

            <div className="space-y-4">
              {/* Step 1 */}
              <div className="flex items-start space-x-3.5">
                <span className="flex items-center justify-center font-mono font-black text-xs bg-slate-100 text-slate-700 h-6.5 w-6.5 rounded-xl shrink-0 border border-slate-200">
                  01
                </span>
                <p className="text-slate-600 text-xs leading-relaxed mt-0.5">
                  Mở tệp trang tính <strong className="text-slate-900 font-bold font-sans">Google Sheets</strong> chứa danh sách câu trả lời của biểu mẫu. Chọn menu <strong className="text-slate-900 font-bold">Tiện ích mở rộng &rarr; Apps Script</strong>.
                </p>
              </div>

              {/* Step 2 */}
              <div className="flex items-start space-x-3.5">
                <span className="flex items-center justify-center font-mono font-black text-xs bg-slate-100 text-slate-705 h-6.5 w-6.5 rounded-xl shrink-0 border border-slate-200">
                  02
                </span>
                <p className="text-slate-600 text-xs leading-relaxed mt-0.5">
                  Xóa sạch đoạn code rỗng mặc định hiện tại, <strong className="text-indigo-600 font-bold">Dán mã thông minh</strong> được cung cấp ở khu bên phải vào, rồi nhấn phím <kbd className="bg-slate-50 border border-slate-200 px-1 py-0.5 rounded text-[10px] font-mono font-bold">Ctrl + S</kbd> để lưu.
                </p>
              </div>

              {/* Step 3 */}
              <div className="flex items-start space-x-3.5">
                <span className="flex items-center justify-center font-mono font-black text-xs bg-indigo-600 text-white h-6.5 w-6.5 rounded-xl shrink-0 border border-indigo-500">
                  03
                </span>
                <div className="text-slate-600 text-xs leading-relaxed mt-0.5 space-y-1.5">
                  <p className="font-bold text-slate-800">
                    Bật bộ kích hoạt theo dõi tự động:
                  </p>
                  <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-500 font-medium">
                    <li>Chọn mục <strong className="text-indigo-600">Trình kích hoạt (hình chiếc đồng hồ)</strong> ở menu dọc trái.</li>
                    <li>Nhấn <strong className="text-slate-900">Thêm Trình kích hoạt (Add Trigger)</strong> ở góc dưới.</li>
                    <li>Chọn chạy hàm: <strong className="text-slate-800 font-bold font-mono text-[10px]">"onFormSubmitTrigger"</strong>.</li>
                    <li>Nguồn sự kiện: <strong className="text-slate-800 font-bold">"Từ trang tính" (From Spreadsheet)</strong>.</li>
                    <li>Loại sự kiện: <strong className="text-slate-800 font-bold">"Khi gửi biểu mẫu" (On form submit)</strong>.</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Warning Info */}
            <div className="bg-indigo-50/50 rounded-2xl border border-indigo-100 p-4 mt-6">
              <div className="flex space-x-2.5 items-start">
                <HelpCircle className="h-5 w-5 text-indigo-500 shrink-0 mt-0.5" />
                <div>
                  <h5 className="text-[10px] font-bold text-indigo-900 uppercase tracking-widest font-mono">Ý nghĩa bảo mật</h5>
                  <p className="text-indigo-800 text-[11px] leading-relaxed mt-1 font-medium">
                    Apps Script là bộ cầu nối trực tiếp đóng form tự động khi hết giờ, giới hạn số phản hồi vượt luồng và chặn email ngoài Whitelist để đảm bảo quy chế thu thập an toàn nhất!
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Code Viewer Column */}
          <div className="md:col-span-7 flex flex-col h-[460px] border border-slate-200 rounded-2xl overflow-hidden shadow-sm bg-slate-950">
            {/* Terminal Window Header */}
            <div className="bg-[#0f0e1a] px-4 py-3 border-b border-indigo-950/40 flex items-center justify-between shrink-0 select-none">
              <div className="flex items-center space-x-2">
                <span className="w-3 h-3 rounded-full bg-rose-500/80 block"></span>
                <span className="w-3 h-3 rounded-full bg-amber-550/80 block"></span>
                <span className="w-3 h-3 rounded-full bg-emerald-500/80 block"></span>
                <span className="text-[10px] font-mono font-bold text-slate-400 pl-2 select-none truncate max-w-[130px] sm:max-w-xs">
                  {folderName ? `gform_manager_${folderName.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'settings'}.js` : 'gform_manager.js'}
                </span>
              </div>
              <button
                onClick={copyToClipboard}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-[11px] font-bold rounded-xl transition-all cursor-pointer shadow-sm shadow-indigo-950"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-300" />
                    <span>Đã sao chép!</span>
                  </>
                ) : (
                  <>
                    <Clipboard className="h-3.5 w-3.5" />
                    <span>Sao chép mã Apps Script</span>
                  </>
                )}
              </button>
            </div>
            {/* Embedded JavaScript Content */}
            <pre className="p-4 text-xs font-mono overflow-auto select-all leading-relaxed flex-1 text-left bg-[#080711] text-indigo-100/90 selection:bg-indigo-500/30">
              {appsScriptCode}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
