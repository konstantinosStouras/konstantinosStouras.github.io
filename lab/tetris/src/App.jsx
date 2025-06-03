import React, { useRef, useState, useEffect, useCallback } from "react";

const GRID_WIDTH = 8;
const GRID_HEIGHT = 12; 
const CELL_SIZE = 50;
const GAP = 2;
const PENALTY_PER_CELL = 0.1; // Used in KPI_1
const ALPHA = 0.7; // Used in KPI_2

// Add helper function for KPI display
const formatKPI = (value) => Number.isInteger(value) ? value : value.toFixed(2);

const styles = {
  page: {
    backgroundColor: '#fdf6e3',
    minHeight: '100vh',
    minWidth: '100vw',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    margin: 0,
    padding: 0,
    overflow: 'auto',
    position: 'relative',
    color: '#000'
  },
  header: {
    textAlign: 'center',
    marginTop: '20px',
    marginBottom: '10px',
    color: '#000',
    maxWidth: '800px',
    padding: '0 20px'
  },
  headerTitle: {
    fontWeight: 'bold',
    color: '#000',
    fontSize: '36px',
    margin: '0 0 10px 0'
  },
  headerDesc: {
    color: '#000',
    fontSize: '16px',
    margin: '5px 0'
  },
  headerTips: {
    color: '#666',
    fontSize: '14px',
    marginTop: '8px',
    lineHeight: '1.4'
  },
  boardRow: {
    display: 'flex',
    flexDirection: 'row',
    gap: '40px',
    alignItems: 'flex-start',
    marginTop: '20px',
    flexWrap: 'wrap',
    justifyContent: 'center'
  },
  boardArea: {
    position: 'relative',
    width: `${GRID_WIDTH * (CELL_SIZE + GAP) + GAP}px`,
    height: `${GRID_HEIGHT * (CELL_SIZE + GAP) + GAP}px`,
    backgroundColor: '#d2b48c',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    zIndex: 0
  },
  kpiPanel: {
    minWidth: '220px',
    padding: '20px',
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    color: '#000',
    fontSize: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  kpiHeader: {
    marginTop: 0,
    marginBottom: '16px',
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
    borderBottom: '2px solid #f0f0f0',
    paddingBottom: '8px'
  },
  kpiRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 0'
  },
  kpiLabel: {
    fontWeight: '500',
    color: '#555'
  },
  kpiValue: {
    fontWeight: 'bold',
    color: '#333'
  },
  finishButton: {
    backgroundColor: '#28a745',
    color: 'white',
    padding: '12px 20px',
    borderRadius: '8px',
    fontWeight: 'bold',
    border: 'none',
    cursor: 'pointer',
    boxShadow: '0 2px 6px rgba(40, 167, 69, 0.3)',
    marginTop: '20px',
    fontSize: '16px',
    transition: 'all 0.2s ease'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: `repeat(${GRID_WIDTH}, ${CELL_SIZE}px)`,
    gridTemplateRows: `repeat(${GRID_HEIGHT}, ${CELL_SIZE}px)`,
    gap: `${GAP}px`,
    backgroundColor: '#000',
    padding: `${GAP}px`
  },
  cell: {
    width: `${CELL_SIZE}px`,
    height: `${CELL_SIZE}px`,
    backgroundColor: '#111',
    border: '1px solid #333',
    boxSizing: 'border-box',
    transition: 'backgroundColor 0.1s ease'
  },
  brickCell: {
    width: `${CELL_SIZE}px`,
    height: `${CELL_SIZE}px`,
    position: 'absolute',
    cursor: 'grab',
    border: '2px solid #000',
    zIndex: 2,
    transition: 'all 0.2s ease',
    borderRadius: '2px'
  },
  selected: {
    boxShadow: '0 0 15px 4px rgba(255, 215, 0, 0.8)',
    transform: 'scale(1.02)',
    zIndex: 10
  },
  bucketArea: {
    marginBottom: '25px',
    display: 'flex',
    justifyContent: 'center',
    gap: '30px',
    padding: '20px',
    border: '2px dashed #bbb',
    borderRadius: '12px',
    backgroundColor: '#f9f5ec',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    flexWrap: 'wrap'
  },
  bucket: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    position: 'relative',
    padding: '10px',
    borderRadius: '8px',
    transition: 'transform 0.2s ease'
  },
  valueLabel: {
    position: 'absolute',
    top: '-20px',
    left: '50%',
    transform: 'translateX(-50%)',
    textAlign: 'center',
    fontWeight: 'bold',
    fontSize: '13px',
    color: '#000',
    backgroundColor: 'rgba(255,255,255,0.95)',
    padding: '2px 8px',
    borderRadius: '6px',
    zIndex: 9999,
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
  },
  countText: {
    fontSize: '18px',
    fontWeight: 'bold',
    marginTop: '10px',
    textAlign: 'center',
    width: '100%',
    color: '#333',
    padding: '4px 8px',
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderRadius: '6px'
  },
  notesArea: {
    marginTop: '30px',
    marginBottom: '60px',
    width: '100%',
    maxWidth: '1000px',
    display: 'flex',
    gap: '25px',
    flexWrap: 'wrap',
    justifyContent: 'center'
  },
  notesPanel: {
    flex: '1',
    minWidth: '300px',
    padding: '20px',
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    color: '#000',
    display: 'flex',
    flexDirection: 'column'
  },
  calculatorPanel: {
    flex: '1',
    minWidth: '300px',
    padding: '20px',
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    color: '#000',
    overflow: 'hidden'
  },
  panelHeader: {
    marginTop: 0,
    marginBottom: '15px',
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
    borderBottom: '2px solid #f0f0f0',
    paddingBottom: '8px'
  },
  textarea: {
    width: '100%',
    height: '50px',
    border: '2px solid #e0e0e0',
    borderRadius: '8px',
    padding: '12px',
    fontSize: '14px',
    fontFamily: 'Consolas, Monaco, monospace',
    resize: 'none',
    outline: 'none',
    transition: 'border-color 0.2s ease'
  },
  notesHistory: {
    flex: '1',
    maxHeight: '300px',
    overflowY: 'auto',
    marginTop: '15px',
    border: '1px solid #e0e0e0',
    borderRadius: '8px',
    backgroundColor: '#fafafa'
  },
  noteEntry: {
    display: 'flex',
    padding: '8px 12px',
    borderBottom: '1px solid #f0f0f0',
    fontSize: '13px',
    lineHeight: '1.4'
  },
  noteTimestamp: {
    minWidth: '65px',
    color: '#666',
    fontWeight: '500',
    marginRight: '12px',
    fontSize: '11px'
  },
  noteMessage: {
    flex: '1',
    color: '#333',
    wordWrap: 'break-word'
  },
  notesInput: {
    marginTop: '10px'
  },
  inputLabel: {
    display: 'block',
    fontSize: '12px',
    color: '#666',
    marginBottom: '5px',
    fontWeight: '500'
  },
  calculatorGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '8px',
    marginTop: '12px',
    width: '100%',
    maxWidth: '100%'
  },
  calcButton: {
    padding: '12px 6px',
    border: '1px solid #ccc',
    borderRadius: '8px',
    backgroundColor: '#ffffff',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: 'bold',
    transition: 'all 0.2s ease',
    userSelect: 'none',
    color: '#333',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    minWidth: 0,
    overflow: 'hidden',
    whiteSpace: 'nowrap'
  },
  calcButtonOperator: {
    backgroundColor: '#007bff',
    color: 'white',
    border: '1px solid #0056b3',
    fontSize: '18px'
  },
  calcButtonEquals: {
    backgroundColor: '#28a745',
    color: 'white',
    border: '1px solid #1e7e34',
    fontSize: '18px'
  },
  calcButtonClear: {
    backgroundColor: '#dc3545',
    color: 'white',
    border: '1px solid #c82333',
    fontSize: '18px'
  },
  calcDisplay: {
    width: '100%',
    padding: '12px',
    border: '2px solid #ddd',
    borderRadius: '8px',
    fontSize: '18px',
    textAlign: 'right',
    backgroundColor: '#ffffff',
    marginBottom: '12px',
    fontFamily: 'Consolas, Monaco, monospace',
    outline: 'none',
    color: '#333',
    fontWeight: 'bold',
    boxSizing: 'border-box'
  },
  brickValue: {
    position: 'absolute',
    zIndex: 9999,
    fontWeight: 'bold',
    fontSize: '11px',
    color: '#000',
    backgroundColor: 'rgba(255,255,255,0.95)',
    padding: '1px 5px',
    borderRadius: '4px',
    pointerEvents: 'none',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
  }
};

const rotateClockwise = (shape) => shape.map(([x, y]) => [y, -x]);
const rotateCounterClockwise = (shape) => shape.map(([x, y]) => [-y, x]);

const BRICK_DEFINITIONS = [
  { type: 'tshape', color: '#32CD32', count: 10, value: 15, shape: [[0, 0], [1, 0], [2, 0], [1, 1]] },
  { type: 'zshape', color: '#9370DB', count: 10, value: 18, shape: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  { type: 'lshape', color: '#FF6347', count: 10, value: 20, shape: [[0, 0], [1, 0], [0, 1]] },
  { type: 'line', color: '#FFD700', count: 10, value: 16, shape: [[0, 0], [1, 0], [2, 0]] }
];

function App() {
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [finalTime, setFinalTime] = useState(null);
  const [brickCounts, setBrickCounts] = useState(
    Object.fromEntries(BRICK_DEFINITIONS.map(b => [b.type, b.count]))
  );
  const [bricks, setBricks] = useState([]);
  const [dragging, setDragging] = useState(null);
  const [selected, setSelected] = useState(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [totalValue, setTotalValue] = useState(0);
  const [coverage, setCoverage] = useState(0);
  const [kpi1, setKpi1] = useState(0); 
  const [kpi2, setKpi2] = useState(0); 
  const [notes, setNotes] = useState('');
  const [noteEntries, setNoteEntries] = useState([]);
  const [calcDisplay, setCalcDisplay] = useState('0');
  const [calcExpression, setCalcExpression] = useState('');
  const [calcPrevValue, setCalcPrevValue] = useState(null);
  const [calcOperation, setCalcOperation] = useState(null);
  const [calcWaitingForOperand, setCalcWaitingForOperand] = useState(false);
  const [calcLastWasOperator, setCalcLastWasOperator] = useState(false);

  const pageRef = useRef(null);
  const boardRef = useRef(null);
  const clickTimers = useRef({});

  // Timer effect with cleanup
  useEffect(() => {
    if (!showSummary) {
      const interval = setInterval(() => setElapsedTime(prev => prev + 1), 1000);
      return () => clearInterval(interval);
    }
  }, [showSummary]);

  // Memoized KPI calculations for better performance
  const calculateKPIs = useCallback(() => {
    const value = bricks.reduce((sum, brick) => {
      const baseType = brick.id.split('-')[0];
      const brickDef = BRICK_DEFINITIONS.find(b => b.type === baseType);
      return sum + (brickDef ? brickDef.value : 0);
    }, 0);

    const filledCells = new Set();
    bricks.forEach(brick => {
      const absoluteCells = getAbsoluteCells(brick, brick.x, brick.y);
      absoluteCells.forEach(([col, row]) => {
        if (col >= 0 && col < GRID_WIDTH && row >= 0 && row < GRID_HEIGHT) {
          filledCells.add(`${col},${row}`);
        }
      });
    });
    
    const usedCells = filledCells.size;
    const totalCells = GRID_WIDTH * GRID_HEIGHT;
    const emptyCells = totalCells - usedCells;

    return {
      totalValue: value,
      coverage: Math.round((usedCells / totalCells) * 100),
      kpi1: Math.max(0, value - PENALTY_PER_CELL * emptyCells),
      kpi2: Math.max(0, Math.round(ALPHA * value + (1 - ALPHA) * usedCells))
    };
  }, [bricks]);

  // Update KPIs when bricks change
  useEffect(() => {
    const kpis = calculateKPIs();
    setTotalValue(kpis.totalValue);
    setCoverage(kpis.coverage);
    setKpi1(kpis.kpi1);
    setKpi2(kpis.kpi2);
  }, [calculateKPIs]);

  const formatTime = (seconds) => {
    const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const getAbsoluteCells = (brick, baseX, baseY) => {
    if (!boardRef.current || !pageRef.current) return [];
    
    const boardRect = boardRef.current.getBoundingClientRect();
    const pageRect = pageRef.current.getBoundingClientRect();
    const offsetX = boardRect.left - pageRect.left + GAP;
    const offsetY = boardRect.top - pageRect.top + GAP;

    return brick.shape.map(([dx, dy]) => {
      const col = Math.floor((baseX - offsetX) / (CELL_SIZE + GAP)) + dx;
      const row = Math.floor((baseY - offsetY) / (CELL_SIZE + GAP)) + dy;
      return [col, row];
    });
  };

  const isWithinBounds = (cells) => {
    return cells.every(([col, row]) => {
      const withinBounds = col >= 0 && col < GRID_WIDTH && row >= 0 && row < GRID_HEIGHT;
      return withinBounds;
    });
  };

  const isOverlapping = (cells, excludeId) => {
    const occupied = new Set();
    for (let b of bricks) {
      if (b.id === excludeId) continue;
      const otherCells = getAbsoluteCells(b, b.x, b.y);
      for (let [col, row] of otherCells) {
        occupied.add(`${col},${row}`);
      }
    }
    return cells.some(([col, row]) => occupied.has(`${col},${row}`));
  };

  const isFromPalette = (brick) => {
    return !brick.hasOwnProperty('wasPlaced') || !brick.wasPlaced;
  };

  const handleMouseDown = useCallback((e, id) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (selected && selected !== id) setSelected(null);
    
    const rect = e.target.getBoundingClientRect();
    setOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setDragging(id);

    const brick = bricks.find(b => b.id === id);
    if (brick && brick.wasPlaced) {
      setBricks(prev => prev.map(b => 
        b.id === id 
          ? { ...b, originalX: b.x, originalY: b.y, originalShape: [...b.shape] }
          : b
      ));
    }

    if (clickTimers.current[id]) {
      clearTimeout(clickTimers.current[id]);
      delete clickTimers.current[id];
      setSelected(prev => prev === id ? null : id);
    } else {
      clickTimers.current[id] = setTimeout(() => {
        delete clickTimers.current[id];
      }, 300);
    }
  }, [selected, bricks]);

  const handleMouseMove = useCallback((e) => {
    if (!dragging || !pageRef.current) return;
    
    const pageRect = pageRef.current.getBoundingClientRect();
    const newX = e.clientX - offset.x - pageRect.left;
    const newY = e.clientY - offset.y - pageRect.top;
    
    setBricks(prev => prev.map(b => 
      b.id === dragging ? { ...b, x: newX, y: newY } : b
    ));
  }, [dragging, offset]);

  const handleMouseUp = useCallback((e) => {
    if (!dragging || !boardRef.current || !pageRef.current) {
      setDragging(null);
      return;
    }

    const boardRect = boardRef.current.getBoundingClientRect();
    const pageRect = pageRef.current.getBoundingClientRect();
    const rawX = e.clientX - boardRect.left;
    const rawY = e.clientY - boardRect.top;

    const col = Math.floor((rawX - GAP) / (CELL_SIZE + GAP));
    const row = Math.floor((rawY - GAP) / (CELL_SIZE + GAP));

    const snappedX = boardRect.left - pageRect.left + GAP + col * (CELL_SIZE + GAP);
    const snappedY = boardRect.top - pageRect.top + GAP + row * (CELL_SIZE + GAP);

    const brick = bricks.find(b => b.id === dragging);
    if (!brick) {
      setDragging(null);
      return;
    }

    const proposedCells = getAbsoluteCells(brick, snappedX, snappedY);
    const droppedOutsideBoard = rawX < 0 || rawY < 0 || rawX > boardRect.width || rawY > boardRect.height;

    const baseCol = Math.floor((snappedX - (boardRect.left - pageRect.left + GAP)) / (CELL_SIZE + GAP));
    const baseRow = Math.floor((snappedY - (boardRect.top - pageRect.top + GAP)) / (CELL_SIZE + GAP));
    
    const allCellsValid = brick.shape.every(([dx, dy]) => {
      const cellCol = baseCol + dx;
      const cellRow = baseRow + dy;
      return cellCol >= 0 && cellCol < GRID_WIDTH && cellRow >= 0 && cellRow < GRID_HEIGHT;
    });

    const isOutOfBounds = !isWithinBounds(proposedCells);
    const hasOverlap = isOverlapping(proposedCells, dragging);

    if (droppedOutsideBoard) {
      if (isFromPalette(brick)) {
        setBricks(prev => prev.filter(b => b.id !== dragging));
      } else {
        setBricks(prev => prev.map(b => 
          b.id === dragging 
            ? { 
                ...b, 
                x: b.lastValidX, 
                y: b.lastValidY,
                shape: b.originalShape || b.shape,
                originalX: undefined,
                originalY: undefined,
                originalShape: undefined,
                preRotationShape: undefined,
                preRotationX: undefined,
                preRotationY: undefined
              } 
            : b
        ));
      }
    } else if (isOutOfBounds || !allCellsValid) {
      if (isFromPalette(brick)) {
        setBricks(prev => prev.filter(b => b.id !== dragging));
      } else {
        const wasRotated = brick.preRotationShape && JSON.stringify(brick.preRotationShape) !== JSON.stringify(brick.shape);
        
        if (wasRotated) {
          setBricks(prev => prev.map(b => 
            b.id === dragging 
              ? { 
                  ...b, 
                  x: b.preRotationX || b.originalX || b.lastValidX, 
                  y: b.preRotationY || b.originalY || b.lastValidY,
                  shape: b.preRotationShape || b.originalShape || b.shape,
                  preRotationShape: undefined,
                  preRotationX: undefined,
                  preRotationY: undefined
                } 
              : b
          ));
        } else {
          setBricks(prev => prev.map(b => 
            b.id === dragging 
              ? { 
                  ...b, 
                  x: b.originalX || b.lastValidX, 
                  y: b.originalY || b.lastValidY,
                  shape: b.originalShape || b.shape
                } 
              : b
          ));
        }
      }
    } else if (hasOverlap) {
      if (isFromPalette(brick)) {
        setBricks(prev => prev.filter(b => b.id !== dragging));
      } else {
        const wasRotated = brick.preRotationShape && JSON.stringify(brick.preRotationShape) !== JSON.stringify(brick.shape);
        
        if (wasRotated) {
          setBricks(prev => prev.map(b => 
            b.id === dragging 
              ? { 
                  ...b, 
                  x: b.preRotationX || b.originalX || b.lastValidX, 
                  y: b.preRotationY || b.originalY || b.lastValidY,
                  shape: b.preRotationShape || b.originalShape || b.shape,
                  preRotationShape: undefined,
                  preRotationX: undefined,
                  preRotationY: undefined
                } 
              : b
          ));
        } else {
          setBricks(prev => prev.map(b => 
            b.id === dragging 
              ? { 
                  ...b, 
                  x: b.originalX || b.lastValidX, 
                  y: b.originalY || b.lastValidY,
                  shape: b.originalShape || b.shape
                } 
              : b
          ));
        }
      }
    } else {
      setBricks(prev => prev.map(b => 
        b.id === dragging 
          ? { 
              ...b, 
              x: snappedX, 
              y: snappedY, 
              lastValidX: snappedX, 
              lastValidY: snappedY, 
              wasPlaced: true,
              originalX: undefined,
              originalY: undefined,
              originalShape: undefined,
              preRotationShape: undefined,
              preRotationX: undefined,
              preRotationY: undefined
            }
          : b
      ));
      
      if (isFromPalette(brick)) {
        const baseType = brick.id.split('-')[0];
        setBrickCounts(prev => ({
          ...prev,
          [baseType]: prev[baseType] - 1
        }));
      }
    }

    setDragging(null);
  }, [dragging, bricks]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      if (selected) {
        const selectedBrick = bricks.find(b => b.id === selected);
        if (selectedBrick && selectedBrick.wasPlaced) {
          setBricks(prev => prev.filter(b => b.id !== selected));
          
          const baseType = selected.split('-')[0];
          setBrickCounts(prev => ({
            ...prev,
            [baseType]: prev[baseType] + 1
          }));
          
          setSelected(null);
        }
      }
      return;
    }
    
    if (!selected || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    
    setBricks(prev => prev.map(b => {
      if (b.id !== selected) return b;
      
      const rotatedShape = e.key === 'ArrowLeft'
        ? rotateCounterClockwise(b.shape)
        : rotateClockwise(b.shape);

      const proposedCells = getAbsoluteCells({ ...b, shape: rotatedShape }, b.x, b.y);

      if (isOverlapping(proposedCells, selected)) return b;

      return { 
        ...b, 
        shape: rotatedShape,
        preRotationShape: b.shape,
        preRotationX: b.x,
        preRotationY: b.y
      };
    }));
  }, [selected, bricks]);

  const handleGlobalClick = useCallback((e) => {
    if (selected && !e.target.closest('[data-brick]')) {
      setSelected(null);
    }
  }, [selected]);

  const evaluateExpression = useCallback((expr) => {
    try {
      // Replace display symbols with JavaScript operators
      let jsExpression = expr
        .replace(/×/g, '*')
        .replace(/÷/g, '/')
        .replace(/=/g, '');
      
      // Remove any trailing operators
      jsExpression = jsExpression.replace(/[+\-*/()]\s*$/, '');
      
      if (!jsExpression) return 0;
      
      // Use Function constructor for safe evaluation (better than eval)
      const result = Function('"use strict"; return (' + jsExpression + ')')();
      
      return isFinite(result) ? result : 0;
    } catch (error) {
      return 0;
    }
  }, []);

  const handleCalculator = useCallback((value) => {
    if (typeof value === 'number') {
      if (calcWaitingForOperand || calcLastWasOperator) {
        setCalcDisplay(String(value));
        setCalcExpression(prev => prev + value);
        setCalcWaitingForOperand(false);
        setCalcLastWasOperator(false);
      } else {
        const newDisplay = calcDisplay === '0' ? String(value) : calcDisplay + value;
        setCalcDisplay(newDisplay);
        if (calcExpression && !calcExpression.includes('=')) {
          // Remove the last number from expression and add the new one
          const expWithoutLastNumber = calcExpression.replace(/\d+\.?\d*$/, '');
          setCalcExpression(expWithoutLastNumber + newDisplay);
        } else {
          setCalcExpression(newDisplay);
        }
      }
    } else {
      switch (value) {
        case 'clear':
          setCalcDisplay('0');
          setCalcExpression('');
          setCalcPrevValue(null);
          setCalcOperation(null);
          setCalcWaitingForOperand(false);
          setCalcLastWasOperator(false);
          break;
        case '=':
          if (calcExpression && !calcExpression.includes('=')) {
            const result = evaluateExpression(calcExpression);
            const finalExpression = calcExpression + '=' + result;
            setCalcDisplay(String(result));
            setCalcExpression(finalExpression);
            setCalcPrevValue(null);
            setCalcOperation(null);
            setCalcWaitingForOperand(true);
            setCalcLastWasOperator(false);
          }
          break;
        case '.':
          if (calcDisplay.indexOf('.') === -1) {
            const newDisplay = calcDisplay + '.';
            setCalcDisplay(newDisplay);
            if (calcExpression && !calcExpression.includes('=')) {
              const expWithoutLastNumber = calcExpression.replace(/\d+\.?\d*$/, '');
              setCalcExpression(expWithoutLastNumber + newDisplay);
            } else {
              setCalcExpression(newDisplay);
            }
          }
          setCalcLastWasOperator(false);
          break;
        case '(':
          if (calcExpression.includes('=')) {
            setCalcExpression('(');
          } else {
            setCalcExpression(prev => prev + '(');
          }
          setCalcDisplay('(');
          setCalcWaitingForOperand(true);
          setCalcLastWasOperator(true);
          break;
        case ')':
          setCalcExpression(prev => prev + ')');
          setCalcDisplay(')');
          setCalcWaitingForOperand(false);
          setCalcLastWasOperator(true);
          break;
        case '+':
        case '-':
        case '*':
        case '/':
          const operatorSymbol = value === '*' ? '×' : value === '/' ? '÷' : value;
          
          if (calcExpression.includes('=')) {
            // Start new calculation with previous result
            const lastResult = calcDisplay;
            setCalcExpression(lastResult + operatorSymbol);
            setCalcPrevValue(lastResult);
          } else {
            setCalcExpression(prev => prev + operatorSymbol);
          }
          
          setCalcDisplay(operatorSymbol);
          setCalcWaitingForOperand(true);
          setCalcLastWasOperator(true);
          setCalcOperation(value);
          break;
        default:
          break;
      }
    }
  }, [calcDisplay, calcExpression, calcWaitingForOperand, calcLastWasOperator, evaluateExpression]);

  const handleNotesKeyPress = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (notes.trim()) {
        const now = new Date();
        const timeString = now.toLocaleTimeString('en-US', { 
          hour12: true, 
          hour: 'numeric', 
          minute: '2-digit'
        });
        
        const newEntry = {
          id: Date.now(),
          timestamp: timeString,
          message: notes.trim(),
          gameTime: formatTime(elapsedTime)
        };
        
        setNoteEntries(prev => [...prev, newEntry]);
        setNotes('');
      }
    }
  }, [notes, elapsedTime]);

  const handleNotesChange = useCallback((e) => {
    setNotes(e.target.value);
  }, []);

  const clearNotes = useCallback(() => {
    setNoteEntries([]);
  }, []);

  const createBrickFromPalette = useCallback((brickType, e) => {
    e.preventDefault();
    const rect = e.target.getBoundingClientRect();
    const pageRect = pageRef.current.getBoundingClientRect();
    const x = e.clientX - pageRect.left - rect.width / 2;
    const y = e.clientY - pageRect.top - rect.height / 2;

    const brickDef = BRICK_DEFINITIONS.find(b => b.type === brickType);
    const newId = `${brickType}-${Date.now()}`;
    const newBrick = {
      id: newId,
      color: brickDef.color,
      shape: brickDef.shape,
      x,
      y,
      wasPlaced: false
    };

    setBricks(prev => prev.filter(b => 
      !(b.id.startsWith(`${brickType}-`) && !b.wasPlaced)
    ).concat(newBrick));

    setDragging(newId);
    setSelected(newId);
    setOffset({ x: rect.width / 2, y: rect.height / 2 });
  }, []);

  // Event listeners with proper cleanup
  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("click", handleGlobalClick);
    
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("click", handleGlobalClick);
    };
  }, [handleMouseMove, handleMouseUp, handleKeyDown, handleGlobalClick]);

  if (showSummary) {
    return (
      <div style={{ 
        backgroundColor: '#fdf6e3',
        minHeight: '100vh',
        minWidth: '100vw',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        margin: 0,
        padding: '40px',
        textAlign: 'center',
        color: '#000'
      }}>
        <h1 style={{ color: '#000', marginBottom: '30px', fontSize: '42px' }}>🎉 Game Complete!</h1>
        <div style={{ backgroundColor: '#fff', padding: '30px', borderRadius: '16px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', maxWidth: '500px' }}>
          <div style={styles.kpiRow}>
            <span style={styles.kpiLabel}>Total Value:</span>
            <span style={styles.kpiValue}>${totalValue}</span>
          </div>
          <div style={styles.kpiRow}>
            <span style={styles.kpiLabel}>Coverage:</span>
            <span style={styles.kpiValue}>{coverage}%</span>
          </div>
          <div style={styles.kpiRow}>
            <span style={styles.kpiLabel}>KPI_1:</span>
            <span style={styles.kpiValue}>${formatKPI(kpi1)}</span>
          </div>
          <div style={styles.kpiRow}>
            <span style={styles.kpiLabel}>KPI_2:</span>
            <span style={styles.kpiValue}>${formatKPI(kpi2)}</span>
          </div>
          <div style={styles.kpiRow}>
            <span style={styles.kpiLabel}>Total Time:</span>
            <span style={styles.kpiValue}>{formatTime(finalTime)}</span>
          </div>
          <div style={styles.kpiRow}>
            <span style={styles.kpiLabel}>Bricks Placed:</span>
            <span style={styles.kpiValue}>{bricks.filter(b => b.wasPlaced).length}</span>
          </div>
        </div>

        <button 
          onClick={() => window.location.reload()} 
          style={{
            backgroundColor: '#007bff',
            color: 'white',
            padding: '16px 32px',
            borderRadius: '12px',
            border: 'none',
            cursor: 'pointer',
            fontSize: '18px',
            fontWeight: 'bold',
            marginTop: '30px',
            boxShadow: '0 4px 12px rgba(0, 123, 255, 0.3)',
            transition: 'transform 0.2s ease'
          }}
          onMouseEnter={(e) => e.target.style.transform = 'translateY(-2px)'}
          onMouseLeave={(e) => e.target.style.transform = 'translateY(0)'}
        >
          🔄 Play Again
        </button>
      </div>
    );
  }

  return (
    <div ref={pageRef} style={styles.page}>
      <div style={styles.header}>
        <h2 style={styles.headerTitle}>
          <span role="img" aria-label="tetris">🧱</span> Tetris Challenge
        </h2>
        <p style={styles.headerDesc}>Drag and drop the bricks into the frame to complete the puzzle!</p>
        <p style={styles.headerTips}>
          💡 <strong>Controls:</strong> Double-click to select • Arrow keys to rotate • Esc to remove • Drag to move
        </p>
      </div>

      {/* Brick palette - moved to top */}
      <div style={styles.bucketArea}>
        {BRICK_DEFINITIONS.filter(brick => brickCounts[brick.type] > 0).map(brick => (
          <div key={brick.type} style={styles.bucket}>
            <div style={{ position: 'relative', width: `${CELL_SIZE * 3}px`, height: `${CELL_SIZE * 3}px` }}>
              {/* Brick Value Label */}
              <div style={styles.valueLabel}>
                ${brick.value}
              </div>

              {/* Brick Preview */}
              {brick.shape.map(([dx, dy], i) => (
                <div
                  key={i}
                  onMouseDown={(e) => createBrickFromPalette(brick.type, e)}
                  style={{
                    ...styles.brickCell,
                    backgroundColor: brick.color,
                    position: 'absolute',
                    left: `${dx * (CELL_SIZE + GAP)}px`,
                    top: `${dy * (CELL_SIZE + GAP)}px`,
                    cursor: 'pointer'
                  }}
                />
              ))}
            </div>
            <div style={styles.countText}>{brickCounts[brick.type]} left</div>
          </div>
        ))}
      </div>

      <div style={styles.boardRow}>
        <div style={styles.boardArea} ref={boardRef}>
          <div style={styles.grid}>
            {[...Array(GRID_WIDTH * GRID_HEIGHT)].map((_, idx) => (
              <div key={idx} style={styles.cell} />
            ))}
          </div>
        </div>

        <div style={styles.kpiPanel}>
          <h3 style={styles.kpiHeader}>📊 Performance</h3>
          <div style={styles.kpiRow}>
            <span style={styles.kpiLabel}>Total Value:</span>
            <span style={styles.kpiValue}>${totalValue}</span>
          </div>
          <div style={styles.kpiRow}>
            <span style={styles.kpiLabel}>Coverage:</span>
            <span style={styles.kpiValue}>{coverage}%</span>
          </div>
          <div style={styles.kpiRow}>
            <span style={styles.kpiLabel}>KPI_1:</span>
            <span style={styles.kpiValue}>${formatKPI(kpi1)}</span>
          </div>
          <div style={styles.kpiRow}>
            <span style={styles.kpiLabel}>KPI_2:</span>
            <span style={styles.kpiValue}>${formatKPI(kpi2)}</span>
          </div>
          <div style={styles.kpiRow}>
            <span style={styles.kpiLabel}>Time:</span>
            <span style={styles.kpiValue}>{formatTime(elapsedTime)}</span>
          </div>
          <div style={styles.kpiRow}>
            <span style={styles.kpiLabel}>Bricks Placed:</span>
            <span style={styles.kpiValue}>{bricks.filter(b => b.wasPlaced).length}</span>
          </div>
          <button
            onClick={() => {
              setFinalTime(elapsedTime);
              setShowSummary(true);
            }}
            style={styles.finishButton}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = '#218838';
              e.target.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = '#28a745';
              e.target.style.transform = 'translateY(0)';
            }}
          >
            🏁 Finish Game
          </button>
        </div>
      </div>

      {/* Render placed bricks with dollar value overlay */}
      {bricks.map(brick => {
        const baseType = brick.id.split('-')[0];
        const brickDef = BRICK_DEFINITIONS.find(b => b.type === baseType);
        return (
          <React.Fragment key={brick.id}>
            {/* Dollar label rendered once per brick */}
            <div style={{
              ...styles.brickValue,
              left: `${Math.round(brick.x)}px`,
              top: `${Math.round(brick.y) - 18}px`
            }}>
              ${brickDef?.value ?? ''}
            </div>

            {/* Render each cell of the brick */}
            {brick.shape.map(([dx, dy], i) => (
              <div
                key={`${brick.id}-${i}`}
                data-brick="true"
                onMouseDown={(e) => handleMouseDown(e, brick.id)}
                style={{
                  ...styles.brickCell,
                  ...(brick.id === selected ? styles.selected : {}),
                  backgroundColor: brick.color,
                  left: `${Math.round(brick.x + dx * (CELL_SIZE + GAP))}px`,
                  top: `${Math.round(brick.y + dy * (CELL_SIZE + GAP))}px`
                }}
              />
            ))}
          </React.Fragment>
        );
      })}

      {/* Notes and Calculator Area - below the frame */}
      <div style={styles.notesArea}>
        {/* Notes Panel - Chatbox Style */}
        <div style={styles.notesPanel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
            <h3 style={styles.panelHeader}>💬 Strategy Chat</h3>
            {noteEntries.length > 0 && (
              <button
                onClick={clearNotes}
                style={{
                  padding: '4px 8px',
                  fontSize: '11px',
                  backgroundColor: '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#c82333'}
                onMouseLeave={(e) => e.target.style.backgroundColor = '#dc3545'}
              >
                🗑️ Clear
              </button>
            )}
          </div>
          
          <div style={styles.chatContainer}>
            {/* Messages Area */}
            <div style={styles.chatMessages}>
              {noteEntries.length === 0 ? (
                <div style={styles.emptyChat}>
                  <div style={{ fontSize: '28px', marginBottom: '12px' }}>💭</div>
                  <div style={{ fontWeight: '600', marginBottom: '6px', fontSize: '16px' }}>Start your strategy log</div>
                  <div style={{ fontSize: '13px', color: '#999', lineHeight: '1.4' }}>
                    Type your thoughts below and press Enter<br />
                    Track your gameplay decisions in real-time
                  </div>
                </div>
              ) : (
                noteEntries.map(entry => (
                  <div key={entry.id} style={styles.chatMessage}>
                    <div style={styles.messageTimestamp}>
                      {entry.timestamp}
                      <div style={{ fontSize: '10px', color: '#999', marginTop: '2px' }}>
                        {entry.gameTime}
                      </div>
                    </div>
                    <div style={styles.messageContent}>
                      {entry.message}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Input Area */}
            <textarea
              style={styles.chatInput}
              value={notes}
              onChange={handleNotesChange}
              onKeyPress={handleNotesKeyPress}
              placeholder="Type your notes here and press enter..."
              rows="3"
              onFocus={(e) => e.target.style.borderColor = '#007bff'}
              onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
            />
          </div>
        </div>

        {/* Calculator Panel */}
        <div style={styles.calculatorPanel}>
          <h3 style={styles.panelHeader}>🧮 Calculator</h3>
          <input
            type="text"
            style={styles.calcDisplay}
            value={calcExpression || calcDisplay}
            readOnly
          />
          <div style={styles.calculatorGrid}>
            <button 
              style={styles.calcButton} 
              onClick={() => handleCalculator('clear')}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#e9ecef'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#f8f9fa'}
            >
              C
            </button>
            <button 
              style={styles.calcButton} 
              onClick={() => handleCalculator('/')}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#e9ecef'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#f8f9fa'}
            >
              ÷
            </button>
            <button 
              style={styles.calcButton} 
              onClick={() => handleCalculator('*')}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#e9ecef'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#f8f9fa'}
            >
              ×
            </button>
            <button 
              style={styles.calcButton} 
              onClick={() => handleCalculator('-')}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#e9ecef'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#f8f9fa'}
            >
              -
            </button>
            
            <button 
              style={styles.calcButton} 
              onClick={() => handleCalculator(7)}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#e9ecef'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#f8f9fa'}
            >
              7
            </button>
            <button 
              style={styles.calcButton} 
              onClick={() => handleCalculator(8)}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#e9ecef'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#f8f9fa'}
            >
              8
            </button>
            <button 
              style={styles.calcButton} 
              onClick={() => handleCalculator(9)}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#e9ecef'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#f8f9fa'}
            >
              9
            </button>
            <button 
              style={styles.calcButton} 
              onClick={() => handleCalculator('+')}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#e9ecef'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#f8f9fa'}
            >
              +
            </button>
            
            <button 
              style={styles.calcButton} 
              onClick={() => handleCalculator(4)}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#e9ecef'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#f8f9fa'}
            >
              4
            </button>
            <button 
              style={styles.calcButton} 
              onClick={() => handleCalculator(5)}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#e9ecef'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#f8f9fa'}
            >
              5
            </button>
            <button 
              style={styles.calcButton} 
              onClick={() => handleCalculator(6)}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#e9ecef'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#f8f9fa'}
            >
              6
            </button>
            <button 
              style={{...styles.calcButton, gridRow: 'span 2'}} 
              onClick={() => handleCalculator('=')}
              onMouseEnter={(e) => {
                e.target.style.backgroundColor = '#28a745';
                e.target.style.color = 'white';
              }}
              onMouseLeave={(e) => {
                e.target.style.backgroundColor = '#f8f9fa';
                e.target.style.color = 'black';
              }}
            >
              =
            </button>
            
            <button 
              style={styles.calcButton} 
              onClick={() => handleCalculator(1)}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#e9ecef'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#f8f9fa'}
            >
              1
            </button>
            <button 
              style={styles.calcButton} 
              onClick={() => handleCalculator(2)}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#e9ecef'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#f8f9fa'}
            >
              2
            </button>
            <button 
              style={styles.calcButton} 
              onClick={() => handleCalculator(3)}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#e9ecef'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#f8f9fa'}
            >
              3
            </button>
            
            <button 
              style={{...styles.calcButton, gridColumn: 'span 2'}} 
              onClick={() => handleCalculator(0)}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#e9ecef'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#f8f9fa'}
            >
              0
            </button>
            <button 
              style={styles.calcButton} 
              onClick={() => handleCalculator('.')}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#e9ecef'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#f8f9fa'}
            >
              .
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;