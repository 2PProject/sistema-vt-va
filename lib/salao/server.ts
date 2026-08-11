// Utilidades SERVER-ONLY do módulo Salão. Nunca importar isto em componentes
// client — usa a service_role do Supabase e segredos de ambiente.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import crypto from 'crypto'

/** Client Supabase com service_role (ignora RLS). Só em route handlers Node. */
export function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Configure SUPABASE_SERVICE_ROLE_KEY para usar o módulo Salão.')
  return createClient(url, key, { auth: { persistSession: false } })
}

function chave(): Buffer {
  const s = process.env.SALON_ENC_KEY
  if (!s || s.length < 16) throw new Error('Configure SALON_ENC_KEY (>= 16 chars) para criptografar a senha do certificado.')
  return crypto.createHash('sha256').update(s).digest() // 32 bytes
}

/** Criptografa (AES-256-GCM). Retorna 'iv:tag:ciphertext' em base64. */
export function encrypt(texto: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', chave(), iv)
  const enc = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':')
}

export function decrypt(blob: string): string {
  const [iv, tag, enc] = blob.split(':')
  const decipher = crypto.createDecipheriv('aes-256-gcm', chave(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(enc, 'base64')), decipher.final()]).toString('utf8')
}
