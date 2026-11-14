/** 众包投稿服务（spec B5） */
import { callApi } from './cloud'

export interface SubmissionCreateResult {
  id: string
  duplicate: boolean
  status: string
}

export function createSubmission(payload: {
  url: string
  sourceChannel?: string
  note?: string
}): Promise<SubmissionCreateResult> {
  return callApi<SubmissionCreateResult>('api-submission', 'submission.create', payload)
}
