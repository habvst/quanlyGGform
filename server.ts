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

      const prompt = `Bạn là một chuyên gia phân tách tài liệu hành chính, bộ khảo sát, và đề thi trắc nghiệm siêu thông minh.
Nhiệm vụ của bạn là bóc tách đoạn văn bản đề thi/khảo sát thô sau đây thành một cấu trúc Biểu mẫu (Google Form) hoàn hảo bao gồm: Tiêu đề biểu mẫu, Mô tả chi tiết, và Danh sách các câu hỏi hoàn chỉnh.

QUY TẮC PHÂN LOẠI CÂU HỎI (type):
- TEXT: Trả lời ngắn thông thường (ví dụ: Họ và tên, Mã nhân viên, Lớp, Email, Số điện thoại, câu trả lời cực ngắn dưới 20 từ).
- PARAGRAPH: Ý kiến đóng góp, nhận xét chi tiết, câu trả lời tự luận dài, mô tả dài.
- MULTIPLE_CHOICE: Câu hỏi trắc nghiệm một đáp án chọn duy nhất (ví dụ các phương án A, B, C, D...). Đây là mặc định cho các câu hỏi trắc nghiệm.
- CHECKBOX: Câu hỏi hộp kiểm cho phép chọn nhiều đáp án cùng lúc.
- DROP_DOWN: Câu hỏi có danh sách thả xuống chọn một đáp án duy nhất (phù hợp cho câu hỏi có nhiều lựa chọn cố định như Tỉnh/Thành phố, Phòng ban).

QUY TẮC BÓC TÁCH VÀ NHẬN DIỆN THÔNG MINH (Cực kỳ quan trọng để đạt độ chính xác 100%):
1. LỌC SẠCH TIÊU ĐỀ & MÔ TẢ:
   - Hãy tìm ra tiêu đề lớn của cuộc khảo sát hoặc đề kiểm tra ở phần trên cùng của văn bản (ví dụ: "ĐỀ KIỂM TRA GIỮA KÌ I MÔN TOÁN 10", "KHẢO SÁT CHẤT LƯỢNG DỊCH VỤ..."). Đưa thông tin này vào trường "title".
   - Các thông tin hành chính, giới thiệu, hướng dẫn làm bài, hoặc thời gian làm bài nên được gom lại một cách đẹp đẽ ở trường "description".
   - Bỏ qua các dòng vô nghĩa, dòng hướng dẫn điền tên hoặc thông tin học sinh nếu bạn đã bóc tách chúng thành các câu hỏi TEXT riêng (ví dụ: Họ tên, Lớp học).

2. NHẬN DIỆN CÂU HỎI VÀ LÀM SẠCH:
   - Nhận diện các câu hỏi dựa theo mọi ký hiệu đầu dòng tiếng Việt: "Câu 1. ", "Câu 2:", "CÂU 3 - ", "Question 4: ", "Q5: ", "1/ ", "2) ", "1.1 ", "1.1. "...
   - Hãy loại bỏ các ký hiệu tiền tố này ra đầu câu hỏi để tiêu đề câu hỏi được văn minh, sạch đẹp nhất (ví dụ: "Câu 1: Thủ đô của Việt Nam là gì?" sẽ chuyển thành "Thủ đô của Việt Nam là gì?").

3. NHẬN DIỆN CÁC PHƯƠNG ÁN LỰA CHỌN (OPTIONS):
   - ĐỐI VỚI PHƯƠNG ÁN CÙNG MỘT DÒNG (Inline options): Đề thi thường ghi các đáp án nối tiếp nhau trên cùng một hàng để tiết kiệm giấy, ví dụ: "A. Hà Nội   B. Hải Phòng   C. Đà Nẵng   D. TP. HCM". Bạn PHẢI tự động tách chúng thành 4 phương án riêng biệt:
     - Lựa chọn 1: "Hà Nội"
     - Lựa chọn 2: "Hải Phòng"
     - Lựa chọn 3: "Đà Nẵng"
     - Lựa chọn 4: "TP. HCM"
   - Loại bỏ hoàn toàn các ký tự nhãn dán như "A. ", "B. ", "C. ", "D. ", "a) ", "b) ", "o ", "- ", "[A]. " ở đầu mỗi phương án để nội dung phương án được sạch đẹp nhất.

4. PHÁT HIỆN ĐÁP ÁN ĐÚNG (correctAnswer):
   - Quét kỹ từng câu hỏi xem có phương án nào có các dấu hiệu đặc biệt chứng tỏ đó là đáp án đúng không:
     - Có dấu sao ở trước hoặc sau đáp án: "*Hà Nội" hoặc "Hà Nội*"
     - Được in đậm hoặc gạch chân trong tài liệu thô.
     - Phía sau câu hỏi hoặc đáp án có chú thích: "(Đáp án đúng: A)", "(Đáp án: B)", "(-> C)", "[x]", "[valid]",...
   - QUÉT BẢNG ĐÁP ÁN CUỐI VĂN BẢN (Answer key list): Rất nhiều đề thi có một bảng đáp án hoặc danh sách đáp án nằm ở cuối tài liệu (ví dụ: "Dưới đây là đáp án:", "BẢNG ĐÁP ÁN: 1.A, 2.B, 3.C, 4.D...", "1-A, 2-B, 3-C"). Bạn hãy phân tích bảng này để map ngược lại đáp án đúng khớp với nội dung đầy đủ của phương án cho từng câu hỏi tương ứng!
   - Giá trị "correctAnswer" phải là nội dung chuỗi đầy đủ và khớp chính xác tuyệt đối với nội dung của phương án đúng đó (hoặc khớp với một trong các chuỗi sạch trong mảng options vừa được bóc tách).

5. PHÁT HIỆN ĐIỂM SỐ (points) VÀ TÙY CHỌN BẮT BUỘC (required):
   - Nếu trong câu hỏi có ghi điểm, ví dụ: "(1đ)", "(1.5 điểm)", "[2 points]", "[3đ]"... hãy bóc tách điểm số đó và lưu dưới dạng số (lấy số nguyên hoặc làm tròn, ví dụ 1.5 hoặc 2 thì ghi là 2). Nếu không thấy ghi điểm, đặt mặc định là 1 điểm cho đề thi/khảo sát.
   - Các câu hỏi thông tin bắt buộc (nhập tên, mã số, hoặc các câu hỏi khảo sát thông thường) hãy đặt "required" là true.

Hãy trả về kết quả dưới dạng JSON hoàn hảo khớp tuyệt đối với cấu trúc Schema sau:
{
  "title": "Tiêu đề biểu mẫu",
  "description": "Mô tả biểu mẫu",
  "questions": [
    {
      "title": "Nội dung câu hỏi sạch đẹp",
      "type": "TEXT" | "PARAGRAPH" | "MULTIPLE_CHOICE" | "CHECKBOX" | "DROP_DOWN",
      "options": ["Phương án 1 sạch sẽ", "Phương án 2 sạch sẽ"...],
      "required": true,
      "points": 1,
      "correctAnswer": "Nội dung phương án đúng khớp chính xác nội dung trong mảng options"
    }
  ]
}

Nội dung văn bản thô cần bóc tách:
---
${text}
---`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            required: ["title", "description", "questions"],
            properties: {
              title: { type: Type.STRING, description: "Tiêu đề biểu mẫu" },
              description: { type: Type.STRING, description: "Mô tả biểu mẫu" },
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  required: ["title", "type", "required"],
                  properties: {
                    title: { type: Type.STRING, description: "Nội dung câu hỏi" },
                    type: { 
                      type: Type.STRING, 
                      description: "Kiểu câu hỏi", 
                      enum: ["TEXT", "PARAGRAPH", "MULTIPLE_CHOICE", "CHECKBOX", "DROP_DOWN"] 
                    },
                    options: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: "Các phương án lựa chọn nếu có"
                    },
                    required: { type: Type.BOOLEAN, description: "Bắt buộc trả lời" },
                    points: { type: Type.INTEGER, description: "Số điểm mặc định cho câu này nếu là đề ôn tập" },
                    correctAnswer: { type: Type.STRING, description: "Đáp án đúng của câu hỏi nếu được phát hiện" }
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
