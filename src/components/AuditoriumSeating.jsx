import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import './AuditoriumSeating.css';

const LOCAL_STORAGE_KEY = 'auditorium_seating_allocations_v2';
const LOCAL_STORAGE_TITLE_KEY = 'auditorium_seating_title_v1';

// Preset allocation labels with distinct indicator colors
const PRESET_LABELS = [
  { label: 'Parents', color: '#98551b', textColor: '#ffffff' },
  { label: 'BBA Aviation', color: '#008000', textColor: '#ffffff' },
  { label: 'BBA General', color: '#8ee28e', textColor: '#111111' },
  { label: 'BCA', color: '#ffd21c', textColor: '#111111' },
  { label: 'MSc', color: '#11aee0', textColor: '#ffffff' },
  { label: 'BCom', color: '#d86bdc', textColor: '#111111' },
  { label: 'BSc Forensic Science', color: '#d51d42', textColor: '#ffffff' },
  { label: 'Guest', color: '#888888', textColor: '#ffffff' },
  { label: 'Reserved', color: '#333333', textColor: '#ffffff' },
];

function seatsPerRow(row) {
  if (row >= 22) return 18;
  return 9 + Math.floor((row - 1) / 2);
}

function generateAuditoriumData(totalRows = 26) {
  const rows = [];
  let leftIdx = 0;
  let middleIdx = 0;
  let rightIdx = 0;

  for (let i = 1; i <= totalRows; i++) {
    const sectionSize = seatsPerRow(i);

    // Left Section
    const left = [];
    for (let j = 1; j <= sectionSize; j++) {
      left.push({ key: `left-${i}-${j}`, row: i, section: 'Left', col: j, type: 'seat-item', sectionIndex: leftIdx++ });
    }

    // Middle Section
    const middle = [];
    for (let j = 1; j <= sectionSize; j++) {
      middle.push({ key: `middle-${i}-${j}`, row: i, section: 'Middle', col: j, type: 'seat-item', sectionIndex: middleIdx++ });
    }

    // Right Section
    const right = [];
    for (let j = 1; j <= sectionSize; j++) {
      right.push({ key: `right-${i}-${j}`, row: i, section: 'Right', col: j, type: 'seat-item', sectionIndex: rightIdx++ });
    }

    rows.push({ rowNumber: i, left, middle, right });
  }

  return rows;
}

const Seat = ({ seat, isSelected, allocation, badgeLevel = 0, onMouseDown, onMouseEnter, onHover }) => {
  if (seat.type === 'hidden') {
    return <div className="seat hidden" />;
  }

  let seatClasses = 'seat';
  if (isSelected) seatClasses += ' selected';
  if (allocation) seatClasses += ' allocated';

  const inlineStyle = allocation
    ? { backgroundColor: allocation.color, color: allocation.textColor || '#ffffff', borderColor: '#000000' }
    : {};

  const titleText = allocation
    ? `[${allocation.label}] Seat #${allocation.number} (Row ${seat.row}, ${seat.section} Section)`
    : `Seat (Row ${seat.row}, ${seat.section} Section)`;

  const levelOffsets = [10, 46, 82, 118];
  const marginBottom = levelOffsets[badgeLevel] || 10;
  const stemHeight = marginBottom - 10;

  return (
    <div
      className={seatClasses}
      style={inlineStyle}
      title={titleText}
      onMouseDown={(e) => {
        e.preventDefault();
        onMouseDown(seat, e);
      }}
      onMouseEnter={() => {
        onMouseEnter(seat);
        onHover && onHover({ ...seat, allocation });
      }}
      onMouseLeave={() => onHover && onHover(null)}
    >
      {/* Floating Group Callout Badge with Downward Arrow & Stem Line */}
      {allocation && allocation.isGroupHeader && (
        <div
          className="label-arrow-badge"
          style={{
            backgroundColor: allocation.color,
            color: allocation.textColor || '#ffffff',
            marginBottom: `${marginBottom}px`,
          }}
        >
          <span>{allocation.label}</span>
          <span className="arrow-down" style={{ borderTopColor: allocation.color }} />
          {stemHeight > 0 && (
            <span
              className="badge-stem-line"
              style={{
                height: `${stemHeight}px`,
                backgroundColor: allocation.color,
              }}
            />
          )}
        </div>
      )}

      {allocation ? allocation.number : null}
    </div>
  );
};

export default function AuditoriumSeating({ totalRows = 26 }) {
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  
  // Load allocations from localStorage
  const [allocations, setAllocations] = useState(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });

  // Load editable diagram heading from localStorage
  const [diagramHeading, setDiagramHeading] = useState(() => {
    try {
      const savedTitle = localStorage.getItem(LOCAL_STORAGE_TITLE_KEY);
      return savedTitle || 'Auditorium Seating Arrangements';
    } catch (e) {
      return 'Auditorium Seating Arrangements';
    }
  });

  const [dragStartSeat, setDragStartSeat] = useState(null);
  const [lastClickedSeat, setLastClickedSeat] = useState(null);
  const [customLabel, setCustomLabel] = useState('');
  const [customColor, setCustomColor] = useState('#222222');
  const [hoveredSeat, setHoveredSeat] = useState(null);
  const [isPopupMinimized, setIsPopupMinimized] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState('');
  
  // Draggable movable popup toolbar state
  const [popupPosition, setPopupPosition] = useState(null);
  const [isDraggingPopup, setIsDraggingPopup] = useState(false);
  const [popupDragOffset, setPopupDragOffset] = useState({ x: 0, y: 0 });

  const exportRef = useRef(null);
  const toolbarRef = useRef(null);

  const handlePopupDragStart = (e) => {
    if (e.target.closest('.header-actions') || e.target.closest('button') || e.target.closest('input')) return;
    e.preventDefault();
    setIsDraggingPopup(true);
    
    if (toolbarRef.current) {
      const rect = toolbarRef.current.getBoundingClientRect();
      setPopupDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  };

  useEffect(() => {
    if (!isDraggingPopup) return;

    const handleMouseMove = (e) => {
      let newX = e.clientX - popupDragOffset.x;
      let newY = e.clientY - popupDragOffset.y;

      const popupWidth = toolbarRef.current ? toolbarRef.current.offsetWidth : 320;
      const popupHeight = toolbarRef.current ? toolbarRef.current.offsetHeight : 160;

      newX = Math.max(10, Math.min(newX, window.innerWidth - popupWidth - 10));
      newY = Math.max(10, Math.min(newY, window.innerHeight - popupHeight - 10));

      setPopupPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDraggingPopup(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingPopup, popupDragOffset]);

  const seatingData = useMemo(() => generateAuditoriumData(totalRows), [totalRows]);

  const totalSeatCount = useMemo(() => {
    let count = 0;
    seatingData.forEach((row) => {
      count += row.left.length + row.middle.length + row.right.length;
    });
    return count;
  }, [seatingData]);

  const allocatedSeatCount = useMemo(() => Object.keys(allocations).length, [allocations]);

  const categorySummary = useMemo(() => {
    const map = {};
    Object.values(allocations).forEach((alloc) => {
      if (!map[alloc.label]) {
        map[alloc.label] = { label: alloc.label, count: 0, color: alloc.color };
      }
      map[alloc.label].count++;
    });
    return Object.values(map);
  }, [allocations]);

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(allocations));
    } catch (e) {}
  }, [allocations]);

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_TITLE_KEY, diagramHeading);
    } catch (e) {}
  }, [diagramHeading]);

  const handleOpenPreviewModal = useCallback(async () => {
    if (!exportRef.current) return;
    setIsExporting(true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    try {
      const canvas = await html2canvas(exportRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      setPreviewDataUrl(dataUrl);
      setShowPreviewModal(true);
    } catch (err) {
      console.error('Failed to generate preview:', err);
    } finally {
      setIsExporting(false);
    }
  }, []);

  // Keyboard shortcut listener: Ctrl+P / Cmd+P -> Open Preview then Save
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        handleOpenPreviewModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleOpenPreviewModal]);

  const groupBadgeLevels = useMemo(() => {
    const headers = Object.keys(allocations)
      .filter((key) => allocations[key] && allocations[key].isGroupHeader)
      .map((key) => {
        const alloc = allocations[key];
        const [section, rowStr, colStr] = key.split('-');
        return {
          key,
          groupId: alloc.groupId,
          row: parseInt(rowStr, 10),
          col: parseInt(colStr, 10),
          section,
        };
      });

    headers.sort((a, b) => a.row - b.row || a.col - b.col);

    const levels = {};
    headers.forEach((h) => {
      const nearbyLevels = new Set();
      headers.forEach((other) => {
        if (other.groupId !== h.groupId && levels[other.groupId] !== undefined) {
          if (other.section === h.section && Math.abs(other.row - h.row) <= 1 && Math.abs(other.col - h.col) <= 9) {
            nearbyLevels.add(levels[other.groupId]);
          }
        }
      });

      let lvl = 0;
      while (nearbyLevels.has(lvl)) {
        lvl++;
      }
      levels[h.groupId] = lvl;
    });

    return levels;
  }, [allocations]);

  const sectionSeatLists = useMemo(() => {
    const lists = { Left: [], Middle: [], Right: [] };
    seatingData.forEach((row) => {
      row.left.forEach((s) => s.type !== 'hidden' && lists.Left.push(s));
      row.middle.forEach((s) => s.type !== 'hidden' && lists.Middle.push(s));
      row.right.forEach((s) => s.type !== 'hidden' && lists.Right.push(s));
    });
    return lists;
  }, [seatingData]);

  useEffect(() => {
    const handleMouseUp = () => setDragStartSeat(null);
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  // Clear seat selection when clicking anywhere outside of seats and the toolbar
  useEffect(() => {
    const handleDocumentMouseDown = (e) => {
      if (
        e.target.closest('.seat') ||
        e.target.closest('.allocation-toolbar') ||
        e.target.closest('.preview-modal-overlay') ||
        e.target.closest('.diagram-heading-input') ||
        e.target.closest('.app-navbar')
      ) {
        return;
      }
      setSelectedKeys(new Set());
      setIsPopupMinimized(false);
    };

    window.addEventListener('mousedown', handleDocumentMouseDown);
    return () => window.removeEventListener('mousedown', handleDocumentMouseDown);
  }, []);

  const getSelectedKeysForRange = useCallback((startSeat, endSeat) => {
    if (!startSeat || !endSeat || startSeat.section !== endSeat.section) {
      return new Set(startSeat ? [startSeat.key] : []);
    }

    const rangeKeys = new Set();
    const section = startSeat.section;
    const rA = startSeat.row;
    const cA = startSeat.col;
    const rB = endSeat.row;
    const cB = endSeat.col;

    if (rA === rB) {
      const minCol = Math.min(cA, cB);
      const maxCol = Math.max(cA, cB);
      const rowObj = seatingData.find((r) => r.rowNumber === rA);
      if (rowObj) {
        const sectionSeats = section === 'Left' ? rowObj.left : section === 'Middle' ? rowObj.middle : rowObj.right;
        sectionSeats.forEach((s) => {
          if (s.type !== 'hidden' && s.col >= minCol && s.col <= maxCol) {
            rangeKeys.add(s.key);
          }
        });
      }
    } else if (rA < rB) {
      seatingData.forEach((rowObj) => {
        const r = rowObj.rowNumber;
        if (r >= rA && r <= rB) {
          const sectionSeats = section === 'Left' ? rowObj.left : section === 'Middle' ? rowObj.middle : rowObj.right;
          sectionSeats.forEach((s) => {
            if (s.type !== 'hidden') {
              if (r === rA && s.col >= cA) {
                rangeKeys.add(s.key);
              } else if (r === rB && s.col <= cB) {
                rangeKeys.add(s.key);
              } else if (r > rA && r < rB) {
                rangeKeys.add(s.key);
              }
            }
          });
        }
      });
    } else {
      seatingData.forEach((rowObj) => {
        const r = rowObj.rowNumber;
        if (r >= rB && r <= rA) {
          const sectionSeats = section === 'Left' ? rowObj.left : section === 'Middle' ? rowObj.middle : rowObj.right;
          sectionSeats.forEach((s) => {
            if (s.type !== 'hidden') {
              if (r === rA && s.col <= cA) {
                rangeKeys.add(s.key);
              } else if (r === rB && s.col >= cB) {
                rangeKeys.add(s.key);
              } else if (r > rB && r < rA) {
                rangeKeys.add(s.key);
              }
            }
          });
        }
      });
    }

    return rangeKeys;
  }, [seatingData]);

  const handleSeatMouseDown = useCallback((seat, e) => {
    setDragStartSeat(seat);

    if (e && e.shiftKey && lastClickedSeat && lastClickedSeat.section === seat.section) {
      const rangeKeys = getSelectedKeysForRange(lastClickedSeat, seat);
      setSelectedKeys((prev) => new Set([...prev, ...rangeKeys]));
    } else {
      setLastClickedSeat(seat);
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(seat.key)) {
          next.delete(seat.key);
        } else {
          next.add(seat.key);
        }
        return next;
      });
    }
  }, [lastClickedSeat, getSelectedKeysForRange]);

  const handleSeatMouseEnter = useCallback((currentSeat) => {
    if (dragStartSeat && currentSeat.section === dragStartSeat.section) {
      const rangeKeys = getSelectedKeysForRange(dragStartSeat, currentSeat);
      setSelectedKeys(rangeKeys);
    }
  }, [dragStartSeat, getSelectedKeysForRange]);

  const applyAllocation = (label, color = customColor, textColor = '#ffffff') => {
    if (!label || !label.trim() || selectedKeys.size === 0) return;

    const allSeats = [...sectionSeatLists.Left, ...sectionSeatLists.Middle, ...sectionSeatLists.Right];
    const sortedSelectedSeats = allSeats.filter((s) => selectedKeys.has(s.key));

    const maxRow = Math.max(...sortedSelectedSeats.map((s) => s.row));
    const topRowSeats = sortedSelectedSeats.filter((s) => s.row === maxRow);
    const topCenterSeat = topRowSeats[Math.floor(topRowSeats.length / 2)];
    const groupId = 'group-' + Date.now();

    setAllocations((prev) => {
      const next = { ...prev };
      sortedSelectedSeats.forEach((seat, index) => {
        next[seat.key] = {
          label,
          color,
          textColor,
          number: index + 1,
          groupId,
          isGroupHeader: seat.key === topCenterSeat.key,
        };
      });
      return next;
    });

    setSelectedKeys(new Set());
    setCustomLabel('');
    setIsPopupMinimized(false);
  };

  const clearSelected = () => {
    setSelectedKeys(new Set());
    setIsPopupMinimized(false);
  };

  const removeAllocationsFromSelected = () => {
    setAllocations((prev) => {
      const next = { ...prev };
      selectedKeys.forEach((key) => {
        delete next[key];
      });
      return next;
    });
    setSelectedKeys(new Set());
    setIsPopupMinimized(false);
  };

  const removeAllAllocations = () => {
    setAllocations({});
    setSelectedKeys(new Set());
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    } catch (e) {}
  };

  const handleExportJPG = async () => {
    if (!exportRef.current) return;
    setIsExporting(true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    try {
      const canvas = await html2canvas(exportRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const link = document.createElement('a');
      link.download = `${diagramHeading.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${Date.now()}.jpg`;
      link.href = canvas.toDataURL('image/jpeg', 0.95);
      link.click();
    } catch (err) {
      console.error('Failed to export JPG:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPDF = async () => {
    if (!exportRef.current) return;
    setIsExporting(true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    try {
      const canvas = await html2canvas(exportRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF({
        orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [canvas.width, canvas.height],
      });
      pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width, canvas.height);
      pdf.save(`${diagramHeading.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${Date.now()}.pdf`);
    } catch (err) {
      console.error('Failed to export PDF:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const handlePrintPreview = () => {
    if (!previewDataUrl) return;
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>${diagramHeading}</title>
            <style>
              body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #fff; }
              img { max-width: 100%; height: auto; }
            </style>
          </head>
          <body>
            <img src="${previewDataUrl}" onload="window.print();window.close();" />
          </body>
        </html>
      `);
      printWindow.document.close();
    }
  };

  return (
    <div className="main-container">

      {/* Modern Enterprise Top Navbar */}
      <header className="app-navbar">
        <div className="brand-section">
          <div className="brand-icon">🏛️</div>
          <div className="brand-info">
            <div className="brand-title">
              Auditorium Seating Planner
            </div>
            <div className="brand-subtitle">Interactive Allocation & Seating Layout Manager</div>
          </div>
          <div className="nav-metrics">
            <span className="metric-pill">📊 Total: {totalSeatCount}</span>
            <span className="metric-pill allocated">✅ Allocated: {allocatedSeatCount}</span>
            <span className="metric-pill">🪑 Available: {totalSeatCount - allocatedSeatCount}</span>
          </div>
        </div>

        <div className="nav-actions">
          <button className="nav-btn primary" onClick={handleOpenPreviewModal} disabled={isExporting} title="Preview layout before saving (Ctrl+P)">
            🔍 Preview & Save <span className="shortcut-kbd">Ctrl+P</span>
          </button>
          <button className="nav-btn secondary" onClick={handleExportJPG} disabled={isExporting}>
            📷 JPG
          </button>
          <button className="nav-btn secondary" onClick={handleExportPDF} disabled={isExporting}>
            📄 PDF
          </button>
          {allocatedSeatCount > 0 && (
            <button className="nav-btn danger" onClick={removeAllAllocations} title="Reset all seat allocations">
              🔄 Reset
            </button>
          )}
        </div>
      </header>

      {/* Category Breakdown & Hover Info Strip */}
      <div className="category-strip">
        <div className="category-pills">
          <span className="strip-label">Allocations:</span>
          {categorySummary.length > 0 ? (
            categorySummary.map((cat) => (
              <span key={cat.label} className="cat-pill">
                <span className="cat-dot" style={{ backgroundColor: cat.color }} />
                {cat.label}: <strong>{cat.count}</strong>
              </span>
            ))
          ) : (
            <span className="text-xs text-slate-400 font-medium">No seats allocated yet. Drag & select seats to assign labels.</span>
          )}
        </div>

        <div className="hover-info-badge">
          {hoveredSeat ? (
            <span>
              {hoveredSeat.allocation ? (
                <strong style={{ color: hoveredSeat.allocation.color }}>
                  [{hoveredSeat.allocation.label}] Seat #{hoveredSeat.allocation.number} ({`Row ${hoveredSeat.row}, ${hoveredSeat.section} Section`})
                </strong>
              ) : (
                `Unassigned Seat (Row ${hoveredSeat.row}, ${hoveredSeat.section} Section)`
              )}
            </span>
          ) : (
            <span>Tip: Drag mouse or use <strong>Shift + Click</strong> range selection</span>
          )}
        </div>
      </div>

      {/* Main Auditorium Seating Workspace */}
      <div className="auditorium-wrapper">
        <div className="export-container" ref={exportRef}>
          
          {/* Custom Editable Diagram Title Heading */}
          <div className="diagram-heading-wrapper">
            {isExporting ? (
              <h1 className="diagram-title-print">{diagramHeading || 'Auditorium Seating Arrangements'}</h1>
            ) : (
              <input
                type="text"
                value={diagramHeading}
                onChange={(e) => setDiagramHeading(e.target.value)}
                placeholder="Enter diagram title heading..."
                className="diagram-heading-input"
                title="Click to edit diagram title"
              />
            )}
          </div>

          {/* Section Headers */}
          <div className="section-headers">
            <div className="section-header-box">
              <span className="section-title-badge">LEFT WING</span>
            </div>
            <div className="section-header-box">
              <span className="section-title-badge">CENTER DECK</span>
            </div>
            <div className="section-header-box">
              <span className="section-title-badge">RIGHT WING</span>
            </div>
          </div>

          {/* Auditorium Grid */}
          <div className="auditorium">
            {seatingData.map((row) => (
              <div key={row.rowNumber} className="row">
                
                {/* Left Section */}
                <div className="section">
                  {row.left.map((seat) => (
                    <Seat
                      key={seat.key}
                      seat={seat}
                      isSelected={selectedKeys.has(seat.key)}
                      allocation={allocations[seat.key]}
                      badgeLevel={allocations[seat.key] && allocations[seat.key].isGroupHeader ? (groupBadgeLevels[allocations[seat.key].groupId] || 0) : 0}
                      onMouseDown={handleSeatMouseDown}
                      onMouseEnter={handleSeatMouseEnter}
                      onHover={setHoveredSeat}
                    />
                  ))}
                </div>

                {/* Middle Section */}
                <div className="section">
                  {row.middle.map((seat) => (
                    <Seat
                      key={seat.key}
                      seat={seat}
                      isSelected={selectedKeys.has(seat.key)}
                      allocation={allocations[seat.key]}
                      badgeLevel={allocations[seat.key] && allocations[seat.key].isGroupHeader ? (groupBadgeLevels[allocations[seat.key].groupId] || 0) : 0}
                      onMouseDown={handleSeatMouseDown}
                      onMouseEnter={handleSeatMouseEnter}
                      onHover={setHoveredSeat}
                    />
                  ))}
                </div>

                {/* Right Section */}
                <div className="section">
                  {row.right.map((seat) => (
                    <Seat
                      key={seat.key}
                      seat={seat}
                      isSelected={selectedKeys.has(seat.key)}
                      allocation={allocations[seat.key]}
                      badgeLevel={allocations[seat.key] && allocations[seat.key].isGroupHeader ? (groupBadgeLevels[allocations[seat.key].groupId] || 0) : 0}
                      onMouseDown={handleSeatMouseDown}
                      onMouseEnter={handleSeatMouseEnter}
                      onHover={setHoveredSeat}
                    />
                  ))}
                </div>

              </div>
            ))}
          </div>

          {/* Architectural Curved Stage */}
          <div className="architectural-stage-wrapper">
            <div className="architectural-stage">
              <span className="stage-accent">▲</span>
              <span>MAIN AUDITORIUM STAGE</span>
              <span className="stage-accent">▲</span>
            </div>
          </div>

        </div>

        {/* Movable Floating Allocation Popup Toolbar */}
        {selectedKeys.size > 0 && (
          <div
            ref={toolbarRef}
            className={`allocation-toolbar ${isPopupMinimized ? 'minimized' : ''}`}
            style={
              popupPosition
                ? { top: `${popupPosition.y}px`, left: `${popupPosition.x}px`, right: 'auto', bottom: 'auto' }
                : {}
            }
          >
            <div
              className="toolbar-header drag-handle"
              onMouseDown={handlePopupDragStart}
              title="Click & drag header to move toolbar anywhere"
            >
              <div className="flex items-center gap-2">
                <span className="drag-icon" title="Drag to move">⋮⋮</span>
                <span className="selected-count-badge">
                  <span>🪑</span>
                  <span>{selectedKeys.size} seats selected</span>
                </span>
              </div>
              <div className="header-actions" onMouseDown={(e) => e.stopPropagation()}>
                <button
                  className="minimize-btn"
                  onClick={() => setIsPopupMinimized(!isPopupMinimized)}
                  title={isPopupMinimized ? "Expand Toolbar" : "Minimize Toolbar"}
                >
                  {isPopupMinimized ? "Expand ⤢" : "Minimize _"}
                </button>
                <button className="cancel-btn" onClick={clearSelected}>Clear</button>
              </div>
            </div>

            {!isPopupMinimized && (
              <>
                {/* Presets */}
                <div className="preset-container">
                  {PRESET_LABELS.map((item) => (
                    <button
                      key={item.label}
                      className="preset-pill"
                      onClick={() => applyAllocation(item.label, item.color, item.textColor)}
                    >
                      <span className="pill-dot" style={{ backgroundColor: item.color }} />
                      {item.label}
                    </button>
                  ))}
                </div>

                {/* Custom Label & Color Input */}
                <div className="custom-label-row">
                  <input
                    type="color"
                    value={customColor}
                    onChange={(e) => setCustomColor(e.target.value)}
                    className="color-picker"
                    title="Choose label color"
                  />
                  <input
                    type="text"
                    placeholder="Custom label..."
                    value={customLabel}
                    onChange={(e) => setCustomLabel(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && applyAllocation(customLabel)}
                    className="custom-input"
                  />
                  <button className="apply-btn" onClick={() => applyAllocation(customLabel)}>
                    Allocate (1..{selectedKeys.size})
                  </button>
                  <button className="unassign-btn" onClick={removeAllocationsFromSelected}>
                    Remove Labels
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Enterprise Preview & Save Modal Overlay (Ctrl+P) */}
        {showPreviewModal && (
          <div className="preview-modal-overlay" onClick={() => setShowPreviewModal(false)}>
            <div className="preview-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="preview-modal-header">
                <div className="preview-modal-title">
                  <span>🔍 Seating Diagram Preview</span>
                  <span className="shortcut-badge">Ctrl + P</span>
                </div>
                <button className="close-modal-btn" onClick={() => setShowPreviewModal(false)} title="Close Preview">
                  ✕
                </button>
              </div>

              <div className="preview-modal-body">
                {previewDataUrl ? (
                  <div className="preview-image-wrapper">
                    <img src={previewDataUrl} alt="Seating Diagram Preview" className="preview-image" />
                  </div>
                ) : (
                  <div className="text-slate-500 font-medium">Generating diagram preview...</div>
                )}
              </div>

              <div className="preview-modal-footer">
                <span className="preview-info">
                  Heading: <strong>"{diagramHeading}"</strong> • Review diagram before saving or printing
                </span>
                <div className="preview-actions">
                  <button className="modal-action-btn jpg" onClick={() => { handleExportJPG(); setShowPreviewModal(false); }}>
                    📷 Save as JPG
                  </button>
                  <button className="modal-action-btn pdf" onClick={() => { handleExportPDF(); setShowPreviewModal(false); }}>
                    📄 Save as PDF (Color)
                  </button>
                  <button className="modal-action-btn print" onClick={handlePrintPreview}>
                    🖨️ Print
                  </button>
                  <button className="modal-action-btn cancel" onClick={() => setShowPreviewModal(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
