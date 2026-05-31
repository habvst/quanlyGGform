import { GoogleGenAI, Type } from "@google/genai";

// Initialize Gemini SDK
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

export default async function handler(req: any, res: any) {
  // Handle CORS & Options requests
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Phương thức không được hỗ trợ. Hãy dùng POST." });
  }

  try {
    const { text } = req.body;
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Thiếu văn bản đầu vào" });
    }

    const prompt = `Bạn là một chuyên gia phân tách tài liệu hành chính và đề thi thông minh. 
Nhiệm vụ của bạn là bóc tách đoạn văn bản đề thi/khảo sát thô sau đây thành một cấu trúc Biểu mẫu (Google Form) hoàn hảo bao gồm: Tiêu đề biểu mẫu, Mô tả, và Danh sách các câu hỏi.

Quy định lựa chọn loại câu hỏi (type):
- TEXT: Trả lời ngắn thông thường (Họ tên, mã NV, mô tả siêu ngắn).
- PARAGRAPH: Nhận xét, ý kiến đóng góp, tự luận dài.
- MULTIPLE_CHOICE: Câu hỏi trắc nghiệm một đáp án (ví dụ các phương án A, B, C, D...).
- CHECKBOX: Câu hỏi hộp kiểm chọn nhiều đáp án.
- DROP_DOWN: Câu hỏi danh sách thả xuống chọn một.

Quy tắc bóc tách thông minh:
1. Hãy tìm các câu hỏi trong văn bản. Lọc bỏ các tiền tố thô như "Câu 1: ", "Câu 2. ", "Question 1 - "... để tiêu đề câu hỏi được sạch đẹp nhất.
2. Với các câu hỏi trắc nghiệm (MULTIPLE_CHOICE / CHECKBOX / DROP_DOWN):
   - Trích xuất toàn bộ các phương án lựa chọn và lọc bỏ các ký hiệu nhãn phương án ở đầu (ví dụ: "A. ", "B. ", "a) ", "b) " hoặc "o ", "- ").
   - Cố gắng phát hiện câu trả lời đúng (correctAnswer) nếu tài liệu có ghi chú sẵn (ví dụ: "Đáp án đúng: A", "-> A", "Đáp án: B", hoặc có gắn dấu hoa thị "*" ở đáp án đúng, ví dụ "*A. ..."). Giá trị correct answer phải là chuỗi của đáp án khớp chính xác với nội dung phương án đó (hoặc ký tự đại diện A/B/C/D).
3. Cố gắng phát hiện ra mức điểm mặc định (points) tối ưu nếu tài liệu có ghi chú số điểm trực tiếp cho câu hỏi đó (ví dụ: "[2 điểm]", "(5đ)"...). Nếu không có, mặc định là 1 điểm.

Trả về kết quả dưới dạng JSON hoàn hảo khớp với cấu trúc Schema sau:
{
  "title": "Tiêu đề biểu mẫu",
  "description": "Mô tả biểu mẫu",
  "questions": [
    {
      "title": "Nội dung câu hỏi sạch sẽ",
      "type": "TEXT" | "PARAGRAPH" | "MULTIPLE_CHOICE" | "CHECKBOX" | "DROP_DOWN",
      "options": ["Phương án A", "Phương án B"...],
      "required": true,
      "points": 1,
      "correctAnswer": "Nội dung phương án đúng hoặc ký tự nhãn đúng"
    }
  ]
}

Nội dung văn bản thô bóc tách:
---
\${text}
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
    res.status(200).json(data);
  } catch (error: any) {
    console.error("Lỗi parse AI từ serverless function Vercel:", error);
    res.status(500).json({ error: error.message || "Không thể bóc tách tài liệu bằng trí tuệ nhân tạo Gemini." });
  }
}
