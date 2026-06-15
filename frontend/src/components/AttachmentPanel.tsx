import React, { useState, useEffect, useRef } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';

interface Attachment {
  id: string;
  original_name: string;
  stored_name: string;
  mime_type: string;
  file_size: number;
  created_at: string;
}

interface Props {
  referenceType: string;
  referenceId: string;
}

export default function AttachmentPanel({ referenceType, referenceId }: Props) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (referenceId) loadFiles();
  }, [referenceId, referenceType]);

  const loadFiles = () => {
    api.get(`/attachments/list/${referenceType}/${referenceId}`)
      .then(r => setFiles(r.data || []))
      .catch(() => {});
  };

  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    setUploading(true);
    try {
      await api.post(`/attachments/upload/${referenceType}/${referenceId}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('File uploaded');
      loadFiles();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Upload failed'); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const deleteFile = async (id: string) => {
    if (!confirm('Delete this attachment?')) return;
    try { await api.delete('/attachments/' + id); toast.success('Deleted'); loadFiles(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const downloadFile = (id: string, name: string) => {
    const token = localStorage.getItem('token');
    window.open(`/api/attachments/download/${id}?token=${token}`, '_blank');
  };

  const previewFile = (id: string, mime: string) => {
    const token = localStorage.getItem('token');
    if (mime.startsWith('image/')) {
      window.open(`/api/attachments/preview/${id}?token=${token}`, '_blank');
    } else {
      window.open(`/api/attachments/download/${id}?token=${token}`, '_blank');
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getIcon = (mime: string) => {
    if (mime.startsWith('image/')) return '🖼';
    if (mime.includes('pdf')) return '📄';
    if (mime.includes('word') || mime.includes('document')) return '📝';
    if (mime.includes('excel') || mime.includes('spreadsheet')) return '📊';
    if (mime.includes('text') || mime.includes('csv')) return '📃';
    return '📎';
  };

  if (!referenceId) return <div className="text-xs text-gray-400 py-2">Save the document first to attach files.</div>;

  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">Attachments ({files.length})</h3>
        <div>
          <input type="file" ref={fileRef} onChange={uploadFile} className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
            {uploading ? 'Uploading...' : '+ Add File'}
          </button>
        </div>
      </div>

      {files.length === 0 ? (
        <p className="text-xs text-gray-400">No attachments. Click &quot;+ Add File&quot; to upload.</p>
      ) : (
        <div className="space-y-2">
          {files.map(f => (
            <div key={f.id} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg hover:bg-gray-100">
              <span className="text-lg">{getIcon(f.mime_type)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{f.original_name}</p>
                <p className="text-[10px] text-gray-400">{formatSize(f.file_size)} · {new Date(f.created_at).toLocaleDateString('en-PH')}</p>
              </div>
              <button onClick={() => previewFile(f.id, f.mime_type)} className="px-2 py-1 text-xs bg-gray-200 rounded hover:bg-gray-300">View</button>
              <button onClick={() => downloadFile(f.id, f.original_name)} className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">DL</button>
              <button onClick={() => deleteFile(f.id)} className="px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
