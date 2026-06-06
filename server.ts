import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Initialize Gemini SDK with named parameter and 'aistudio-build' User-Agent httpOptions
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));

  // API routes FIRST
  app.post("/api/gemini/parse-form", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Thiếu văn bản đầu vào" });
      }

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `Sau đây là nội dung tài liệu thô (Word/văn bản thô) cần bóc tách. Hãy phân tích cấu trúc, tiêu đề, và tất cả danh sách câu hỏi:
---
${text}
---`,
        config: {
          systemInstruction: `Bạn là một chuyên gia cao cấp hàng đầu về kiến trúc dữ liệu và xử lý ngôn ngữ tự nhiên (NLP) tiếng Việt, chuyên bóc tách các tài liệu hành chính, y học lâm sàng, quy trình kỹ thuật bệnh viện, bảng khảo sát và đề thi trắc nghiệm.
Nhiệm vụ của bạn là phân tích đoạn văn bản thô được cung cấp, nhận diện cấu trúc tệp để chuyển đổi thành biểu mẫu Google Form dưới dạng JSON hoàn chỉnh và sạch đẹp 100%.

QUY TRÌNH PHÂN LOẠI CÁU TRÚC:
1. TIÊU ĐỀ & MÔ TẢ (title & description):
   - Xác định tiêu đề chính ở phần trên cùng của văn bản (Ví dụ: "QUY TRÌNH KỸ THUẬT CẤP CỨU NGỪNG HÔ HẤP - TUẦN HOÀN (HỒI SINH TIM PHỔI)", "KHẢO SÁT CHẤT LƯỢNG DỊCH VỤ..."). Lưu vào trường "title".
   - Thu thập tất cả thông tin hành chính, mục đích khảo sát, hướng dẫn làm bài, thông tin ban hành, thời gian làm bài, ký hiệu văn bản ban ngành vào trường "description".
   - Loại bỏ các dòng thông báo điền thông tin cá nhân chung nếu bạn đã chuyển chúng thành câu hỏi TEXT riêng (Ví dụ: Họ tên người làm, Số điện thoại...).

2. NHẬN DIỆN CÂU HỎI & LOẠI BỎ SỐ THỨ TỰ THỪA:
   - Nhận diện câu hỏi qua mọi ký hiệu tiền tố phổ biến: "Câu 1. ", "Câu 2:", "CÂU 3 - ", "Question 4: ", "Q5: ", "1/ ", "1.1. ", "a) "...
   - Hãy LOẠI BỎ hoàn toàn các ký hiệu số thứ tự/ký tự đánh dấu đầu dòng này khỏi tiêu đề câu hỏi để nội dung câu hỏi được sạch sẽ, trực quan bậc nhất (Ví dụ: "Câu 1: Thời gian vàng cấp cứu ngừng thở là bao nhiêu?" chuyển thành "Thời gian vàng cấp cứu ngừng thở là bao nhiêu?").

3. PHÂN LOẠI KIỂU CÂU HỎI (type):
   - TEXT: Cho các câu hỏi nhập thông tin ngắn, dữ liệu cá nhân (ví dụ: "Họ và tên", "Đơn vị công tác", "Mã nhân viên", "Số điện thoại", "Mã số bệnh nhân").
   - PARAGRAPH: Dành cho nhận xét, ý kiến đóng góp, tự luận dài, chẩn đoán chi tiết hoặc ghi chú lâm sàng.
   - MULTIPLE_CHOICE: Khảo sát một lựa chọn hoặc câu hỏi trắc nghiệm gốc chỉ chọn 1 đáp án duy nhất (có các lựa chọn A, B, C, D...). Đây là kiểu mặc định cho mọi danh sách trắc nghiệm.
   - CHECKBOX: Câu hỏi cho phép lựa chọn nhiều đáp án hoặc tích chọn bảng kiểm thực hiện kỹ thuật lâm sàng (ví dụ checklist "Có thực hiện", "Không thực hiện", "Đạt", "Không đạt" nhưng chọn nhiều).
   - DROP_DOWN: Danh sách thả xuống chọn một phương án duy nhất (Ví dụ: "Chức vụ", "Học hàm học vị", "Tên Khoa/Phòng" nơi có danh sách dài danh mục cố định).

4. BÓC TÁCH PHƯƠNG ÁN LỰA CHỌN (options):
   - TÁCH ĐÁP ÁN TRÊN CÙNG MỘT DÒNG (Inline parsing): Rất nhiều tài liệu nén các lựa chọn trên 1 dòng để tiết kiệm không gian, ví dụ "A. 4 phút    B. 10 phút    C. 15 phút    D. 30 phút". Bạn PHẢI bóc tách thông minh thành 4 phần tử mảng độc lập: ["4 phút", "10 phút", "15 phút", "30 phút"].
   - Làm sạch phương án: Bạn PHẢI LOẠI BỎ hoàn toàn các nhãn dán như "A. ", "B. ", "C- ", "D) ", "a. ", "b) ", "[A]. " ở đầu mỗi đáp án. Các phương án trong mảng "options" phải hoàn toàn sạch sẽ, không chứa ký hiệu nhãn.

5. PHÁT HIỆN ĐÁP ÁN ĐÚNG (correctAnswer) & QUÉT BẢNG ĐÁP ÁN (Answer Key):
   - Quét kỹ xem có bất kỳ phương án nào có dấu sao ở đầu/cuối: "*A. 4 phút" hoặc "4 phút*", in đậm, gạch chân đại diện cho đáp án đúng.
   - Rất quan trọng: Nếu cuối văn bản có danh sách đáp án, ví dụ "BẢNG ĐÁP ÁN: 1.A, 2.D, 3.C..." hoặc "Đáp án: Câu 1 - A; Câu 2 - D", hãy tự khớp nhãn "A", "D" với nội dung đầy đủ của phương án của câu hỏi tương ứng và gán chính xác văn bản đó cho trường "correctAnswer" (correctAnswer bắt buộc phải là một chuỗi văn bản sạch, trùng khớp hoàn toàn với một trong các phần tử trong mảng options của câu hỏi đó).

6. ĐIỂM SỐ (points) & BẮT BUỘC (required):
   - Đọc các thông tin điểm số trong câu hỏi nếu có dạng "(1.5 điểm)", "(2đ)"... để gán vào trường points (chuyển về kiểu số nguyên). Nếu không đề xuất, hãy đặt mặc định 1 điểm cho các câu hỏi ôn tập/kiểm tra.
   - Các câu hỏi cơ bản hoặc khảo sát đều nên đặt mặc định "required": true trừ phi có ghi chú khác.`,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            required: ["title", "description", "questions"],
            properties: {
              title: { type: Type.STRING, description: "Tiêu đề biểu mẫu" },
              description: { type: Type.STRING, description: "Mô tả biểu mẫu chứa thông tin hành chính, hướng dẫn" },
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  required: ["title", "type", "required"],
                  properties: {
                    title: { type: Type.STRING, description: "Nội dung tiêu đề câu hỏi thô sạch sẽ, không chứa tiền tố số thứ tự" },
                    type: { 
                      type: Type.STRING, 
                      description: "Kiểu câu hỏi", 
                      enum: ["TEXT", "PARAGRAPH", "MULTIPLE_CHOICE", "CHECKBOX", "DROP_DOWN"] 
                    },
                    options: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: "Các phương án lựa chọn đã được lọc bỏ nhãn danh mục (A, B, C...)"
                    },
                    required: { type: Type.BOOLEAN, description: "Bắt buộc trả lời" },
                    points: { type: Type.INTEGER, description: "Số điểm mặc định cho câu hỏi" },
                    correctAnswer: { type: Type.STRING, description: "Nội dung sạch của đáp án đúng, khớp chính xác 100% với một đáp án trong mảng options" }
                  }
                }
              }
            }
          }
        }
      });

      const textResult = response.text?.trim() || "{}";
      const data = JSON.parse(textResult);
      res.json(data);
    } catch (error: any) {
      console.error("Lỗi parse AI từ server:", error);
      res.status(500).json({ error: error.message || "Không thể bóc tách tài liệu bằng trí tuệ nhân tạo Gemini." });
    }
  });

  // Proxy endpoint to execute Google Apps Script requests server-side bypassing CORS restrictions
  app.post("/api/apps-script-proxy", async (req, res) => {
    try {
      const { url, payload } = req.body;
      if (!url) {
        return res.status(400).json({ error: "Thiếu địa chỉ URL Apps Script Web App" });
      }

      console.log(`[Proxy] Gửi yêu cầu Apps Script: ${url}`);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain", // Use text/plain to comply with Apps Script POST handler expectations
        },
        body: JSON.stringify(payload)
      });

      const responseText = await response.text();

      try {
        const jsonData = JSON.parse(responseText);
        res.json(jsonData);
      } catch (e) {
        // If the response is not valid JSON, send it as plain text or handle redirect-based outputs
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.send(responseText);
      }
    } catch (error: any) {
      console.error("[Apps Script Proxy Error]:", error);
      res.status(500).json({ error: error.message || "Không thể đồng bộ qua máy chủ trung gian." });
    }
  });

  // Vite middleware development / production
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
