/** PascalCase reference_type values for the attachments API */
export const ATTACHMENT_REF = {
  SalesQuotation: 'SalesQuotation',
  SalesOrder: 'SalesOrder',
  DeliveryNote: 'DeliveryNote',
  SalesInvoice: 'SalesInvoice',
  SalesReturn: 'SalesReturn',
  CollectionReceipt: 'CollectionReceipt',
  PurchaseRequisition: 'PurchaseRequisition',
  PurchaseOrder: 'PurchaseOrder',
  GoodsReceipt: 'GoodsReceipt',
  PurchaseReturn: 'PurchaseReturn',
  ApVoucher: 'ApVoucher',
  PaymentVoucher: 'PaymentVoucher',
} as const;

export type AttachmentReferenceType = (typeof ATTACHMENT_REF)[keyof typeof ATTACHMENT_REF];
