import { query } from '../config/database';

export type SignatureBlock = { label: string; sub?: string; imageUrl?: string };

export async function getBusinessSignatureBlocks(): Promise<SignatureBlock[]> {
  const r = await query(
    `SELECT prepared_by, prepared_by_position, approved_by, approved_by_position,
            prepared_by_signature_url, approved_by_signature_url
     FROM business_details WHERE id = 1`
  );
  const b = r.rows[0] || {};
  const prepSub = [b.prepared_by, b.prepared_by_position].filter(Boolean).join(' · ');
  const apprSub = [b.approved_by, b.approved_by_position].filter(Boolean).join(' · ');
  return [
    {
      label: 'Prepared by',
      sub: prepSub || undefined,
      imageUrl: b.prepared_by_signature_url ? '/api/settings/signature/prepared' : undefined,
    },
    {
      label: 'Approved by',
      sub: apprSub || undefined,
      imageUrl: b.approved_by_signature_url ? '/api/settings/signature/approved' : undefined,
    },
  ];
}

export async function getSalesPrintSignatures(): Promise<SignatureBlock[]> {
  const blocks = await getBusinessSignatureBlocks();
  return [
    blocks[0],
    { label: 'Checked by' },
    blocks[1],
    { label: 'Received by' },
  ];
}

export async function getTwoPartySignatures(): Promise<SignatureBlock[]> {
  const blocks = await getBusinessSignatureBlocks();
  return [blocks[0], { label: 'Received by' }];
}
