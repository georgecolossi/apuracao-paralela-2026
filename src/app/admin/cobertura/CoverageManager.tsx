'use client';

import { useState } from 'react';
import { Search, Save, Check } from 'lucide-react';

interface Municipality {
  id: string;
  name: string;
  officialCode: string;
  isCoverage: boolean;
  state?: { abbreviation: string };
}

export default function CoverageManager({ initialMunicipalities }: { initialMunicipalities: Municipality[] }) {
  const [municipalities, setMunicipalities] = useState(initialMunicipalities);
  const [searchTerm, setSearchTerm] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const toggleCoverage = (code: string) => {
    setMunicipalities(prev => prev.map(m => 
      m.officialCode === code ? { ...m, isCoverage: !m.isCoverage } : m
    ));
    setMessage('');
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    
    const coveredCodes = municipalities.filter(m => m.isCoverage).map(m => m.officialCode);

    try {
      const res = await fetch('/api/admin/cobertura', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coverageCodes: coveredCodes })
      });
      
      if (!res.ok) throw new Error('Erro ao salvar');
      
      setMessage('Cobertura salva com sucesso!');
    } catch (e) {
      setMessage('Ocorreu um erro ao salvar a cobertura.');
    } finally {
      setSaving(false);
    }
  };

  const filtered = municipalities.filter(m => {
    const term = searchTerm.toLowerCase();
    const uf = m.state?.abbreviation?.toLowerCase() || '';
    const searchString = `${m.name.toLowerCase()} ${uf} ${m.officialCode}`;
    return searchString.includes(term);
  });

  const selectedCount = municipalities.filter(m => m.isCoverage).length;

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <input 
            type="text" 
            placeholder="Pesquisar município..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving || selectedCount === 0}
          className="flex items-center justify-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors font-medium"
        >
          <Save size={20} />
          {saving ? 'Salvando...' : 'Salvar Cobertura'}
        </button>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg ${message.includes('sucesso') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {message}
        </div>
      )}

      <div className="text-sm text-gray-500 dark:text-gray-400 mb-4 font-medium">
        {selectedCount} município(s) selecionado(s) para a cobertura.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto pr-2 border-t border-gray-200 dark:border-gray-700 pt-4">
        {filtered.map(m => (
          <div 
            key={m.officialCode}
            onClick={() => toggleCoverage(m.officialCode)}
            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              m.isCoverage 
                ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-500 dark:border-blue-500/50' 
                : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-blue-300'
            }`}
          >
            <div className={`flex items-center justify-center w-5 h-5 rounded border ${
              m.isCoverage ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-400'
            }`}>
              {m.isCoverage && <Check size={14} strokeWidth={3} />}
            </div>
            <div>
              <div className={`font-medium ${m.isCoverage ? 'text-blue-900 dark:text-blue-100' : 'text-gray-700 dark:text-gray-300'}`}>
                {m.name} / {m.state?.abbreviation}
              </div>
              <div className="text-xs text-gray-400">
                TSE: {m.officialCode}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
