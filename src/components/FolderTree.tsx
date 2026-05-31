/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { 
  Folder, FolderOpen, ChevronRight, ChevronDown, Search, 
  Layers, Minimize2, Maximize2, Check, AlertCircle 
} from 'lucide-react';
import { DriveFolder } from '../types';

interface TreeNode {
  id: string;
  name: string;
  parents?: string[];
  children: TreeNode[];
}

interface FolderTreeProps {
  folders: DriveFolder[];
  selectedFolderId: string;
  onSelectFolder: (id: string, name: string) => void;
}

export default function FolderTree({ folders, selectedFolderId, onSelectFolder }: FolderTreeProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedFolderIds, setExpandedFolderIds] = useState<Record<string, boolean>>({});

  // 1. Build tree structure from flat folders
  const roots = useMemo(() => {
    const map: Record<string, TreeNode> = {};
    folders.forEach(f => {
      map[f.id] = { ...f, children: [] };
    });

    const rootNodes: TreeNode[] = [];
    folders.forEach(f => {
      const node = map[f.id];
      if (!node) return;
      
      let isChild = false;
      if (f.parents && f.parents.length > 0) {
        const parentId = f.parents[0];
        if (map[parentId]) {
          map[parentId].children.push(node);
          isChild = true;
        }
      }
      if (!isChild) {
        rootNodes.push(node);
      }
    });

    // Sort alphabetically
    const sortNodes = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      nodes.forEach(n => {
        if (n.children.length > 0) {
          sortNodes(n.children);
        }
      });
    };
    sortNodes(rootNodes);

    return rootNodes;
  }, [folders]);

  // 2. Perform search and identify matching expansion keys
  const { filteredRoots, autoExpandedKeys } = useMemo(() => {
    const keys = new Set<string>();
    if (!searchTerm.trim()) {
      return { filteredRoots: roots, autoExpandedKeys: keys };
    }

    const term = searchTerm.toLowerCase();

    const process = (node: TreeNode): TreeNode | null => {
      const isMatched = node.name.toLowerCase().includes(term);
      const matchedChildren: TreeNode[] = [];

      node.children.forEach(child => {
        const processedChild = process(child);
        if (processedChild) {
          matchedChildren.push(processedChild);
        }
      });

      if (isMatched || matchedChildren.length > 0) {
        if (matchedChildren.length > 0) {
          keys.add(node.id);
        }
        return {
          ...node,
          children: matchedChildren
        };
      }
      return null;
    };

    const results: TreeNode[] = [];
    roots.forEach(root => {
      const processed = process(root);
      if (processed) {
        results.push(processed);
      }
    });

    return { filteredRoots: results, autoExpandedKeys: keys };
  }, [roots, searchTerm]);

  // If a search occurs, merge auto-expanded keys into visual states
  useEffect(() => {
    if (autoExpandedKeys.size > 0) {
      const updated = { ...expandedFolderIds };
      autoExpandedKeys.forEach(id => {
        updated[id] = true;
      });
      setExpandedFolderIds(updated);
    }
  }, [autoExpandedKeys]);

  // Toggle single folder
  const toggleFolder = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolderIds(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // Expand all nodes
  const expandAll = () => {
    const updated: Record<string, boolean> = {};
    const traverse = (nodes: TreeNode[]) => {
      nodes.forEach(n => {
        if (n.children.length > 0) {
          updated[n.id] = true;
          traverse(n.children);
        }
      });
    };
    traverse(roots);
    setExpandedFolderIds(updated);
  };

  // Collapse all nodes
  const collapseAll = () => {
    setExpandedFolderIds({});
  };

  // Recursive rendering function for a single node inside the tree
  const renderNode = (node: TreeNode, depth: number = 0) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = !!expandedFolderIds[node.id];
    const isSelected = selectedFolderId === node.id;

    return (
      <div key={node.id} className="relative select-none text-left font-sans">
        {/* Connection line guides */}
        {depth > 0 && (
          <div 
            className="absolute left-[7px] top-0 bottom-0 w-px bg-slate-200/80 -translate-x-[12px]"
            style={{ left: `${depth * 20 - 13}px` }}
          />
        )}

        <div 
          onClick={() => onSelectFolder(node.id, node.name)}
          className={`flex items-center justify-between py-2 px-3 rounded-xl cursor-pointer text-xs font-semibold select-none group transition-all my-0.5 ${
            isSelected 
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100' 
              : 'hover:bg-slate-50 text-slate-705 border border-transparent'
          }`}
          style={{ paddingLeft: `${Math.max(12, depth * 20 + 8)}px` }}
        >
          <div className="flex items-center space-x-2.5 min-w-0">
            {/* Collapse/Expand chevron */}
            <button
              onClick={(e) => toggleFolder(node.id, e)}
              className={`p-0.5 rounded hover:bg-black/5 flex items-center justify-center shrink-0 ${
                !hasChildren ? 'opacity-0 pointer-events-none' : ''
              } ${isSelected ? 'hover:bg-white/10 text-white/90' : 'text-slate-400'}`}
              type="button"
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 stroke-[2.5]" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 stroke-[2.5]" />
              )}
            </button>

            {/* Folder icon */}
            <span className="shrink-0">
              {isSelected ? (
                <FolderOpen className="h-4 w-4 text-white shrink-0 fill-white/20" />
              ) : isExpanded ? (
                <FolderOpen className="h-4 w-4 text-yellow-500 fill-yellow-100 shrink-0" />
              ) : (
                <Folder className="h-4 w-4 text-slate-400 fill-slate-100 group-hover:text-amber-500 group-hover:fill-amber-50 shrink-0" />
              )}
            </span>

            {/* Folder name text */}
            <span className={`truncate ${isSelected ? 'font-bold' : 'font-medium'}`}>
              {node.name}
            </span>
          </div>

          <div className="flex items-center space-x-2.5 shrink-0 pl-2">
            {/* Children item badges count */}
            {hasChildren && !isSelected && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-bold">
                {node.children.length}
              </span>
            )}

            {/* Selected confirmation checkbox */}
            {isSelected && (
              <span className="bg-white/25 rounded-md p-0.5">
                <Check className="h-3.5 w-3.5 text-white stroke-[3.5]" />
              </span>
            )}
          </div>
        </div>

        {/* Render child nodes if expanded */}
        {hasChildren && isExpanded && (
          <div className="relative">
            {node.children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-4 overflow-hidden flex flex-col space-y-3">
      {/* Search and control bar */}
      <div className="flex items-center space-x-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Lọc thư mục, dự án..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 outline-none rounded-xl bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 text-slate-700 font-medium transition-all"
          />
        </div>

        {/* Tree controls buttons */}
        <div className="flex items-center space-x-1 shrink-0">
          <button
            onClick={expandAll}
            type="button"
            className="p-2 bg-slate-50 hover:bg-slate-100 rounded-xl transition-all border border-slate-150 text-slate-500 hover:text-slate-700 cursor-pointer"
            title="Mở rộng tất cả"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={collapseAll}
            type="button"
            className="p-2 bg-slate-50 hover:bg-slate-100 rounded-xl transition-all border border-slate-150 text-slate-500 hover:text-slate-700 cursor-pointer"
            title="Thu hẹp tất cả"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Actual Tree scroll box container */}
      <div className="max-h-[300px] overflow-y-auto pr-1 flex-1 border border-slate-100 rounded-2xl p-2 bg-slate-50/30 scrollbar-thin">
        {folders.length === 0 ? (
          <div className="text-center py-10 px-4">
            <Layers className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="text-slate-500 text-xs font-semibold">Đang nạp danh sách thư mục của bạn...</p>
          </div>
        ) : filteredRoots.length === 0 ? (
          <div className="text-center py-10 px-4">
            <AlertCircle className="h-8 w-8 text-amber-500/80 mx-auto mb-2" />
            <p className="text-slate-600 text-xs font-semibold">Không tìm thấy thư mục nào phù hợp</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Vui lòng thay đổi từ khóa</p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredRoots.map(root => renderNode(root, 0))}
          </div>
        )}
      </div>

      {/* Selected indicator bar feedback */}
      <div className="bg-indigo-50/50 border border-indigo-100/60 rounded-2xl p-2.5 px-3 flex items-center justify-between text-left">
        <div className="truncate pr-2">
          <span className="text-[9px] font-mono font-bold text-indigo-500 uppercase tracking-widest block">Thư mục chọn:</span>
          <span className="text-[11px] font-bold text-slate-800 truncate block">
            {selectedFolderId 
              ? folders.find(f => f.id === selectedFolderId)?.name || 'Thư mục được chọn' 
              : 'Chưa có thư mục nào được chọn'
            }
          </span>
        </div>
        <div className="h-6 w-px bg-indigo-200/50" />
        <div className="pl-3 shrink-0 flex items-center space-x-1 font-mono text-[10px] text-indigo-600 font-bold">
          <Layers className="h-3.5 w-3.5 text-indigo-500" />
          <span>{folders.length} Folders</span>
        </div>
      </div>
    </div>
  );
}
