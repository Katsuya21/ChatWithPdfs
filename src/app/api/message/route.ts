import { db } from '@/db'
import { openai } from '@/lib/openai'
// import { getPineconeClient } from '@/lib/pinecone'
import { Pinecone } from '@pinecone-database/pinecone'
import { SendMessageValidator } from '@/lib/validators/SendMessageValidator'
import { getKindeServerSession } from '@kinde-oss/kinde-auth-nextjs/server'
import { OpenAIEmbeddings } from 'langchain/embeddings/openai'
import { PineconeStore } from 'langchain/vectorstores/pinecone'
import { NextRequest } from 'next/server'
import {GoogleGenerativeAI} from '@google/generative-ai'
import {ChatOpenAI} from '@langchain/openai'
import {pdfToText} from 'pdf-ts'
import { OpenAIStream, StreamingTextResponse } from 'ai'
import { useUploadThing } from '@/lib/uploadthing'
import { PDFExtract,PDFExtractResult } from 'pdf.js-extract'
import axios, { AxiosError } from 'axios'
async function getPdfContent(url: string): Promise<string> {
  try {
    // Fetch the PDF file
    const response = await axios.get(url, {
      responseType: 'arraybuffer'
    });

    // Create a new PDFExtract instance
    const pdfExtract = new PDFExtract();

    // Extract the content
    const data: PDFExtractResult = await pdfExtract.extractBuffer(response.data);

    // Concatenate the text from all pages
    const text = data.pages.map(page => page.content.map(item => item.str).join(' ')).join('\n');

    return text;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 404) {
        console.error('Error: PDF file not found. Please check the URL and ensure the file exists.');
      } else {
        console.error('Error fetching PDF:', axiosError.message);
      }
    } else {
      console.error('Error extracting PDF content:', error);
    }
    throw error;
  }
}

export const POST = async (req: NextRequest) => {
  // endpoint for asking a question to a pdf file

  // const use = require('@tensorflow-models/universal-sentence-encoder')


  const body = await req.json()

  const { getUser } = getKindeServerSession()
  const user = getUser()

  const { id: userId } = user

  if (!userId)
    return new Response('Unauthorized', { status: 401 })

  const { fileId, message } =
    SendMessageValidator.parse(body)

  const file = await db.file.findFirst({
    where: {
      id: fileId,
      userId,
    },
  })

  if (!file)
    return new Response('Not found', { status: 404 })

  await db.message.create({
    data: {
      text: message,
      isUserMessage: true,
      userId,
      fileId,
    },
  })
  const prevMessages = await db.message.findMany({
    where: {
      fileId,
    },
    orderBy: {
      createdAt: 'asc',
    },
    take: 6,
  })

  const formattedPrevMessages = prevMessages.map((msg) => ({
    role: msg.isUserMessage
      ? ('user' as const)
      : ('assistant' as const),
    content: msg.text,
  }))

  const fileUrl= `https://utfs.io/f/${file.id}`

  const content = getPdfContent(fileUrl)

  console.log(content)

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `
    Use the following pieces of context to answer the user's question:

    PREVIOUS CONVERSATION:
    ${formattedPrevMessages.map((message) => {
      if (message.role === 'user') {
        return `User: ${message.content}\n`;
      }
      return `Assistant: ${message.content}\n`;   

    }).join('')}

    CONTEXT:
    ${pdfContent}

    USER INPUT: ${message}
  `;

  const result = await model.generateContent(prompt);
  console.log(result.response.text());

  

  // 1: vectorize message
  // const embeddings = new OpenAIEmbeddings({
  //   openAIApiKey: process.env.OPENAI_API_KEY,
  // })

  const embeddings = await use.loadTokenizer().then((tokenizer: { encode: (arg0: string) => void })=>{
    tokenizer.encode(message)
  })

  const pinecone = new Pinecone({
    apiKey:process.env.PINECONE_API_KEY!,
    environment: 'us-east-1',
  })
  // const pineconeIndex = pinecone.Index('quill')

  const pineconeIndex = await pinecone.createIndex({
    name: 'quill',
    dimension: 512,
    metric: 'cosine',
  })

  // const vectorStore = await PineconeStore.fromExistingIndex(
  //   embeddings,
  //   {
  //     pineconeIndex,
  //     namespace: file.id,
  //   }
  // )
  const vectorStore = await pineconeIndex.upsert(embeddings)

  const results = await vectorStore.similaritySearch(
    message,
    4
  )

  

  // const response = await openai.chat.completions.create({
  //   model: 'gpt-3.5-turbo',
  //   temperature: 0,
  //   stream: true,
  //   messages: [
  //     {
  //       role: 'system',
  //       content:
  //         'Use the following pieces of context (or previous conversaton if needed) to answer the users question in markdown format.',
  //     },
  //     {
  //       role: 'user',
  //       content: `Use the following pieces of context (or previous conversaton if needed) to answer the users question in markdown format. \nIf you don't know the answer, just say that you don't know, don't try to make up an answer.
        
  // \n----------------\n
  
  // PREVIOUS CONVERSATION:
  // ${formattedPrevMessages.map((message) => {
  //   if (message.role === 'user')
  //     return `User: ${message.content}\n`
  //   return `Assistant: ${message.content}\n`
  // })}
  
  // \n----------------\n
  
  // CONTEXT:
  // ${results.map((r) => r.pageContent).join('\n\n')}
  
  // USER INPUT: ${message}`,
  //     },
  //   ],
  // })

  // const stream = OpenAIStream(response, {
  //   async onCompletion(completion) {
  //     await db.message.create({
  //       data: {
  //         text: completion,
  //         isUserMessage: false,
  //         fileId,
  //         userId,
  //       },
  //     })
  //   },
  // })

  return new StreamingTextResponse(stream)
}
