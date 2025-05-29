import React, { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, ScatterChart, Scatter, LineChart, Line } from 'recharts';
import { Search, Users, Building, DollarSign, Target, Network, AlertCircle, CheckCircle, TrendingUp, Filter, FileText, RefreshCw } from 'lucide-react';
import Papa from 'papaparse';

const HubSpotRelationshipMapper = () => {
  const [deals, setDeals] = useState([]); // Tyler deals - comprehensive master set
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeStrategy, setActiveStrategy] = useState('overview');
  const [searchTerm, setSearchTerm] = useState('');
  const [dataRefreshTime, setDataRefreshTime] = useState(null);

  // Load and parse CSV data
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Load Tyler deals data from public folder
        const dealsResponse = await fetch('/tylerdeals2.csv');
        if (!dealsResponse.ok) {
          throw new Error(`Failed to load deals data: ${dealsResponse.status} ${dealsResponse.statusText}`);
        }
        const dealsText = await dealsResponse.text();
        
        // Load companies data from public folder
        const companiesResponse = await fetch('/hubspot-crm-exports-tyler-companies-2025-05-29.csv');
        if (!companiesResponse.ok) {
          throw new Error(`Failed to load companies data: ${companiesResponse.status} ${companiesResponse.statusText}`);
        }
        const companiesText = await companiesResponse.text();
        
        // Parse deals CSV
        const dealsParsed = Papa.parse(dealsText, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          transformHeader: (header) => header.trim(),
          complete: function(results) {
            console.log(`Deals parsed: ${results.data.length} records`);
            if (results.errors.length > 0) {
              console.warn("Errors parsing deals:", results.errors);
            }
          }
        });
        
        // Parse companies CSV
        const companiesParsed = Papa.parse(companiesText, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          transformHeader: (header) => header.trim(),
          complete: function(results) {
            console.log(`Companies parsed: ${results.data.length} records`);
            if (results.errors.length > 0) {
              console.warn("Errors parsing companies:", results.errors);
            }
          }
        });
        
        // Set the data
        setDeals(dealsParsed.data || []);
        setCompanies(companiesParsed.data || []);
        setDataRefreshTime(new Date());
        
        console.log('Data loaded successfully:', {
          deals: dealsParsed.data?.length || 0,
          companies: companiesParsed.data?.length || 0
        });
        
      } catch (error) {
        console.error('Error loading data:', error);
        setError(error.message);
        setDeals([]);
        setCompanies([]);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // Strategy 1: Enhanced Relationship Mapping - Direct ID based
  const directIdMapping = useMemo(() => {
    if (!deals.length || !companies.length) return [];

    const mappings = [];
    let unmappedCount = 0;
    
    deals.forEach(deal => {
      const primaryCompanyId = deal['Associated Company IDs (Primary)'];
      
      if (primaryCompanyId !== undefined && primaryCompanyId !== null && String(primaryCompanyId).trim() !== '') {
        // Find the matching company by ID
        const company = companies.find(c => String(c['Record ID']) === String(primaryCompanyId));
        
        if (company) {
          mappings.push({
            dealId: deal['Record ID'],
            dealName: deal['Deal Name'] || 'Unnamed Deal',
            companyId: company['Record ID'],
            companyName: company['Company name'] || 'Unnamed Company',
            relationship: 'primary',
            confidence: 100, // Direct ID match = 100% confidence
            amount: parseFloat(deal['Budget']) || 0, // Always use Budget as specified
            campaignBrand: deal['Campaign Brand'] || '',
            dealStage: deal['Deal Stage'] || 'Unknown',
            pipeline: deal['Pipeline'] || 'Unknown',
            closeDate: deal['Close Date'],
            createDate: deal['Create Date'],
            isClosedWon: deal['Is Closed Won'] === true || (deal['Deal Stage'] && String(deal['Deal Stage']).toLowerCase().includes('won'))
          });
        } else {
          unmappedCount++;
        }
      } else {
        unmappedCount++;
      }
    });

    console.log(`Direct ID Mapping: ${mappings.length} mapped, ${unmappedCount} unmapped`);
    return mappings;
  }, [deals, companies]);

  // Strategy 2: Domain-Based Relationship Inference
  const domainMapping = useMemo(() => {
    const domainGroups = {};
    
    companies.forEach(company => {
      const domain = company['Company Domain Name'];
      if (domain && typeof domain === 'string' && domain.trim() !== '') {
        const cleanDomain = domain.toLowerCase().replace(/^www\./, '').trim();
        const rootDomain = cleanDomain.split('.').slice(-2).join('.');
        
        if (!domainGroups[rootDomain]) {
          domainGroups[rootDomain] = [];
        }
        domainGroups[rootDomain].push(company);
      }
    });

    const relationships = [];
    Object.entries(domainGroups).forEach(([domain, relatedCompanies]) => {
      if (relatedCompanies.length > 1) {
        // Find the "parent" company (highest revenue or most deals)
        const companiesWithMetrics = relatedCompanies.map(company => {
          const dealCount = directIdMapping.filter(m => m.companyId === company['Record ID']).length;
          const totalRevenue = parseFloat(company['Total Revenue']) || 0;
          return { ...company, dealCount, totalRevenue };
        });
        
        const parent = companiesWithMetrics.reduce((prev, curr) => {
          // Prioritize by deal count, then by revenue
          if (curr.dealCount > prev.dealCount) return curr;
          if (curr.dealCount === prev.dealCount && curr.totalRevenue > prev.totalRevenue) return curr;
          return prev;
        });

        relatedCompanies.forEach(company => {
          if (company['Record ID'] !== parent['Record ID']) {
            relationships.push({
              parentId: parent['Record ID'],
              parentName: parent['Company name'] || 'Unnamed Parent',
              childId: company['Record ID'],
              childName: company['Company name'] || 'Unnamed Child',
              confidence: 75,
              basis: 'domain',
              domain: domain,
              parentDealCount: parent.dealCount,
              parentRevenue: parent.totalRevenue
            });
          }
        });
      }
    });

    return relationships;
  }, [companies, directIdMapping]);

  // Strategy 3: Enhanced Brand-to-Company Attribution
  const brandMapping = useMemo(() => {
    const brandRevenue = {};
    const brandCompanies = {};
    const brandDealCounts = {};
    const brandPipelines = {};
    const brandStages = {};
    const brandTimeSeries = {};

    deals.forEach(deal => {
      const brandsRaw = deal['Campaign Brand'];
      const brands = (brandsRaw && typeof brandsRaw === 'string') 
        ? brandsRaw.split(';').map(b => b.trim()).filter(b => b !== '') 
        : [];
      const revenue = parseFloat(deal['Budget']) || 0;
      const pipeline = deal['Pipeline'] || 'Unknown';
      const stage = deal['Deal Stage'] || 'Unknown';
      const primaryCompanyId = deal['Associated Company IDs (Primary)'];
      const closeDate = deal['Close Date'];
      
      brands.forEach(brand => {
        if (brand && typeof brand === 'string' && brand !== '') {
          // Revenue aggregation
          brandRevenue[brand] = (brandRevenue[brand] || 0) + revenue;
          
          // Deal count tracking
          brandDealCounts[brand] = (brandDealCounts[brand] || 0) + 1;
          
          // Pipeline tracking
          if (!brandPipelines[brand]) {
            brandPipelines[brand] = {};
          }
          brandPipelines[brand][pipeline] = (brandPipelines[brand][pipeline] || 0) + 1;
          
          // Stage tracking
          if (!brandStages[brand]) {
            brandStages[brand] = {};
          }
          brandStages[brand][stage] = (brandStages[brand][stage] || 0) + 1;
          
          // Time series tracking
          if (closeDate) {
            const monthYear = new Date(closeDate).toISOString().slice(0, 7);
            if (!brandTimeSeries[brand]) {
              brandTimeSeries[brand] = {};
            }
            brandTimeSeries[brand][monthYear] = (brandTimeSeries[brand][monthYear] || 0) + revenue;
          }
          
          // Associate brand with primary company ID if available
          if (primaryCompanyId !== undefined && primaryCompanyId !== null && String(primaryCompanyId).trim() !== '') {
            if (!brandCompanies[brand]) {
              brandCompanies[brand] = new Set();
            }
            brandCompanies[brand].add(primaryCompanyId);
          }
        }
      });
    });

    // Calculate brand metrics
    const brandMetrics = Object.keys(brandRevenue).map(brand => {
      const avgDealSize = brandRevenue[brand] / brandDealCounts[brand];
      const companyCount = brandCompanies[brand]?.size || 0;
      const stages = brandStages[brand] || {};
      const wonDeals = Object.entries(stages)
        .filter(([stage]) => stage.toLowerCase().includes('won'))
        .reduce((sum, [, count]) => sum + count, 0);
      const winRate = wonDeals / brandDealCounts[brand] * 100;
      
      return {
        brand,
        revenue: brandRevenue[brand],
        dealCount: brandDealCounts[brand],
        avgDealSize,
        companyCount,
        winRate,
        pipelines: brandPipelines[brand] || {},
        stages: stages
      };
    }).sort((a, b) => b.revenue - a.revenue);

    return { 
      brandRevenue, 
      brandCompanies, 
      brandDealCounts, 
      brandPipelines,
      brandStages,
      brandTimeSeries,
      brandMetrics,
      totalBrands: Object.keys(brandRevenue).length,
      totalBrandRevenue: Object.values(brandRevenue).reduce((sum, rev) => sum + rev, 0)
    };
  }, [deals]);

  // Strategy 4: Enhanced Revenue Validation - Updated for Associated Company column
  const revenueValidation = useMemo(() => {
    const companyDealAnalysis = {};
    
    deals.forEach(deal => {
      const associatedCompaniesRaw = deal['Associated Company'];
      const dealMediaBudget = parseFloat(deal['Budget']) || 0;
      const dealPOAmount = parseFloat(deal['Amount']) || 0;
      const dealStage = deal['Deal Stage'] || 'Unknown';
      const isClosedWon = deal['Is Closed Won'] === true || (dealStage && dealStage.toLowerCase().includes('won'));
      
      // Parse associated companies from semicolon-separated string
      const associatedCompanies = (associatedCompaniesRaw && typeof associatedCompaniesRaw === 'string') 
        ? associatedCompaniesRaw.split(';').map(c => c.trim()).filter(c => c !== '') 
        : [];
      
      // For each company in the associated companies list
      associatedCompanies.forEach(companyName => {
        if (!companyDealAnalysis[companyName]) {
          companyDealAnalysis[companyName] = {
            companyName: companyName,
            totalMediaBudget: 0,
            totalPOAmount: 0,
            dealCount: 0,
            wonDeals: 0,
            openDeals: 0,
            lostDeals: 0,
            deals: []
          };
        }
        
        // Add the full amounts to each company
        companyDealAnalysis[companyName].totalMediaBudget += dealMediaBudget;
        companyDealAnalysis[companyName].totalPOAmount += dealPOAmount;
        companyDealAnalysis[companyName].dealCount += 1;
        companyDealAnalysis[companyName].deals.push({
          name: deal['Deal Name'] || 'Unnamed Deal',
          stage: dealStage,
          mediaBudget: dealMediaBudget,
          poAmount: dealPOAmount,
          closeDate: deal['Close Date']
        });
        
        if (isClosedWon) {
          companyDealAnalysis[companyName].wonDeals += 1;
        } else if (dealStage && dealStage.toLowerCase().includes('lost')) {
          companyDealAnalysis[companyName].lostDeals += 1;
        } else {
          companyDealAnalysis[companyName].openDeals += 1;
        }
      });
    });
    
    // Calculate validation metrics
    return Object.entries(companyDealAnalysis).map(([companyName, analysis]) => {
      return {
        companyName: analysis.companyName,
        totalMediaBudget: analysis.totalMediaBudget,
        totalPOAmount: analysis.totalPOAmount,
        dealCount: analysis.dealCount,
        wonDeals: analysis.wonDeals,
        openDeals: analysis.openDeals,
        lostDeals: analysis.lostDeals,
        winRate: analysis.dealCount > 0 ? (analysis.wonDeals / analysis.dealCount) * 100 : 0,
        avgPOAmount: analysis.dealCount > 0 ? analysis.totalPOAmount / analysis.dealCount : 0,
        avgMediaBudget: analysis.dealCount > 0 ? analysis.totalMediaBudget / analysis.dealCount : 0,
        deals: analysis.deals
      };
    }).filter(item => item.totalMediaBudget > 0 || item.totalPOAmount > 0);
  }, [deals]);

  // Combined relationship analysis
  const combinedRelationships = useMemo(() => {
    const combined = [];
    
    // Add direct ID mappings
    directIdMapping.forEach(mapping => {
      combined.push({
        ...mapping,
        strategy: 'Enhanced ID',
        type: 'deal-company'
      });
    });

    // Add domain relationships
    domainMapping.forEach(rel => {
      combined.push({
        ...rel,
        strategy: 'Domain',
        type: 'parent-child'
      });
    });

    return combined;
  }, [directIdMapping, domainMapping]);

  // Filter relationships based on search
  const filteredRelationships = useMemo(() => {
    if (!searchTerm) return combinedRelationships;
    
    const lowerSearch = searchTerm.toLowerCase();
    return combinedRelationships.filter(rel => 
      rel.dealName?.toLowerCase().includes(lowerSearch) ||
      rel.companyName?.toLowerCase().includes(lowerSearch) ||
      rel.parentName?.toLowerCase().includes(lowerSearch) ||
      rel.childName?.toLowerCase().includes(lowerSearch) ||
      rel.campaignBrand?.toLowerCase().includes(lowerSearch)
    );
  }, [combinedRelationships, searchTerm]);

  // Enhanced Strategy statistics
  const strategyStats = useMemo(() => {
    const totalDealValue = deals.reduce((sum, deal) => sum + (parseFloat(deal['Budget']) || 0), 0);
    const closedWonDeals = deals.filter(deal => {
      const stage = deal['Deal Stage'];
      const isWon = deal['Is Closed Won'];
      return isWon === true || (stage && typeof stage === 'string' && stage.toLowerCase().includes('won'));
    }).length;
    
    const openDeals = deals.filter(deal => {
      const stage = deal['Deal Stage'];
      return stage && typeof stage === 'string' && 
             !stage.toLowerCase().includes('closed') && 
             !stage.toLowerCase().includes('lost') &&
             !stage.toLowerCase().includes('won');
    }).length;
    
    const lostDeals = deals.filter(deal => {
      const stage = deal['Deal Stage'];
      return stage && typeof stage === 'string' && stage.toLowerCase().includes('lost');
    }).length;
    
    const stats = {
      totalDeals: deals.length,
      totalCompanies: companies.length,
      directMappings: directIdMapping.length,
      domainRelationships: domainMapping.length,
      revenueAccuracy: revenueValidation.filter(r => r.winRate > 50).length,
      totalRevenue: totalDealValue,
      totalBrands: brandMapping.totalBrands,
      closedWonDeals,
      openDeals,
      lostDeals,
      winRate: deals.length > 0 ? (closedWonDeals / deals.length) * 100 : 0,
      averageDealSize: deals.length > 0 ? totalDealValue / deals.length : 0,
      mappingCoverage: deals.length > 0 ? (directIdMapping.length / deals.length) * 100 : 0,
      pipelineDistribution: {},
      stageDistribution: {}
    };
    
    // Calculate pipeline distribution
    deals.forEach(deal => {
      const pipeline = deal['Pipeline'];
      const pipelineName = (pipeline && typeof pipeline === 'string') ? pipeline : 'Unknown';
      stats.pipelineDistribution[pipelineName] = (stats.pipelineDistribution[pipelineName] || 0) + 1;
      
      const stage = deal['Deal Stage'];
      const stageName = (stage && typeof stage === 'string') ? stage : 'Unknown';
      stats.stageDistribution[stageName] = (stats.stageDistribution[stageName] || 0) + 1;
    });
    
    return stats;
  }, [deals, companies, directIdMapping, domainMapping, revenueValidation, brandMapping]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-lg text-gray-600">Loading HubSpot CRM data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Error Loading Data</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <p className="text-sm text-gray-500">
            Please ensure the CSV files are in the public folder:
            <br />• /public/tylerdeals2.csv
            <br />• /public/hubspot-crm-exports-tyler-companies-2025-05-29.csv
          </p>
          <button 
            onClick={() => window.location.reload()} 
            className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 inline-flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D', '#FFC658'];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <div className="bg-white shadow-lg border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <Network className="text-indigo-600" />
                HubSpot CRM Relationship Mapper
              </h1>
              <p className="text-gray-600 mt-2">
                Comprehensive analysis of {deals.length.toLocaleString()} deals worth ${(strategyStats.totalRevenue / 1000000).toFixed(1)}M across {companies.length} companies
              </p>
              {dataRefreshTime && (
                <p className="text-sm text-gray-500 mt-1">
                  Data loaded at {dataRefreshTime.toLocaleTimeString()}
                </p>
              )}
            </div>
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search relationships..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent w-64"
                />
              </div>
              <button 
                onClick={() => window.location.reload()} 
                className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
                title="Refresh data"
              >
                <RefreshCw className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Strategy Tabs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="border-b border-gray-200 overflow-x-auto">
            <nav className="flex space-x-8 px-6 min-w-max">
              {[
                { id: 'overview', name: 'Overview', icon: TrendingUp },
                { id: 'direct-ids', name: 'Enhanced ID Mapping', icon: Target },
                { id: 'domain', name: 'Domain Analysis', icon: Building },
                { id: 'brand-attribution', name: 'Brand Attribution', icon: DollarSign },
                { id: 'revenue-validation', name: 'Revenue Validation', icon: CheckCircle }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveStrategy(tab.id)}
                  className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                    activeStrategy === tab.id
                      ? 'border-indigo-500 text-indigo-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.name}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-6">
            {/* Overview Tab */}
            {activeStrategy === 'overview' && (
              <div className="space-y-6">
                {/* Key Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                  <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg p-6 text-white">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-blue-100">Total Deals</p>
                        <p className="text-2xl font-bold">{strategyStats.totalDeals.toLocaleString()}</p>
                        <p className="text-sm text-blue-200">Tyler Master Set</p>
                      </div>
                      <FileText className="w-8 h-8 text-blue-200" />
                    </div>
                  </div>
                  
                  <div className="bg-gradient-to-r from-green-500 to-green-600 rounded-lg p-6 text-white">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-green-100">Total Revenue</p>
                        <p className="text-2xl font-bold">${(strategyStats.totalRevenue / 1000000).toFixed(1)}M</p>
                        <p className="text-sm text-green-200">From Budget</p>
                      </div>
                      <DollarSign className="w-8 h-8 text-green-200" />
                    </div>
                  </div>
                  
                  <div className="bg-gradient-to-r from-purple-500 to-purple-600 rounded-lg p-6 text-white">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-purple-100">Win Rate</p>
                        <p className="text-2xl font-bold">{strategyStats.winRate.toFixed(1)}%</p>
                        <p className="text-sm text-purple-200">{strategyStats.closedWonDeals} won deals</p>
                      </div>
                      <Target className="w-8 h-8 text-purple-200" />
                    </div>
                  </div>
                  
                  <div className="bg-gradient-to-r from-orange-500 to-orange-600 rounded-lg p-6 text-white">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-orange-100">Active Brands</p>
                        <p className="text-2xl font-bold">{strategyStats.totalBrands}</p>
                        <p className="text-sm text-orange-200">Campaign brands</p>
                      </div>
                      <Building className="w-8 h-8 text-orange-200" />
                    </div>
                  </div>

                  <div className="bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-lg p-6 text-white">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-indigo-100">Mapping Coverage</p>
                        <p className="text-2xl font-bold">{strategyStats.mappingCoverage.toFixed(1)}%</p>
                        <p className="text-sm text-indigo-200">{strategyStats.directMappings} mapped</p>
                      </div>
                      <Network className="w-8 h-8 text-indigo-200" />
                    </div>
                  </div>
                </div>

                {/* Deal Funnel Analysis */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="bg-gray-50 rounded-lg p-6 lg:col-span-2">
                    <h3 className="text-lg font-semibold mb-4">Deal Funnel Analysis</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={[
                        { stage: 'Total Deals', count: strategyStats.totalDeals, color: '#3B82F6' },
                        { stage: 'Open Deals', count: strategyStats.openDeals, color: '#F59E0B' },
                        { stage: 'Won Deals', count: strategyStats.closedWonDeals, color: '#10B981' },
                        { stage: 'Lost Deals', count: strategyStats.lostDeals, color: '#EF4444' }
                      ]}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="stage" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="count" fill="#4F46E5">
                          {[
                            <Cell key="cell-0" fill="#3B82F6" />,
                            <Cell key="cell-1" fill="#F59E0B" />,
                            <Cell key="cell-2" fill="#10B981" />,
                            <Cell key="cell-3" fill="#EF4444" />
                          ]}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-6">
                    <h3 className="text-lg font-semibold mb-4">Key Insights</h3>
                    <div className="space-y-3">
                      <div className="p-3 bg-white rounded border border-gray-200">
                        <h4 className="font-medium text-gray-900">Average Deal Size</h4>
                        <p className="text-2xl font-bold text-indigo-600">
                          ${(strategyStats.averageDealSize / 1000).toFixed(0)}K
                        </p>
                      </div>
                      <div className="p-3 bg-white rounded border border-gray-200">
                        <h4 className="font-medium text-gray-900">Open Pipeline</h4>
                        <p className="text-2xl font-bold text-orange-600">
                          ${(directIdMapping
                            .filter(d => !d.isClosedWon && d.dealStage && !d.dealStage.toLowerCase().includes('lost'))
                            .reduce((sum, d) => sum + d.amount, 0) / 1000000).toFixed(1)}M
                        </p>
                      </div>
                      <div className="p-3 bg-white rounded border border-gray-200">
                        <h4 className="font-medium text-gray-900">Companies w/ Deals</h4>
                        <p className="text-2xl font-bold text-purple-600">
                          {new Set(directIdMapping.map(m => m.companyId)).size}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Strategy Effectiveness Chart */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-gray-50 rounded-lg p-6">
                    <h3 className="text-lg font-semibold mb-4">Strategy Effectiveness</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={[
                        { strategy: 'ID Mapping', mappings: strategyStats.directMappings, confidence: 100 },
                        { strategy: 'Domain Analysis', mappings: strategyStats.domainRelationships, confidence: 75 },
                        { strategy: 'Brand Attribution', mappings: strategyStats.totalBrands, confidence: 60 },
                        { strategy: 'Revenue Validation', mappings: strategyStats.revenueAccuracy, confidence: 85 }
                      ]}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="strategy" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="mappings" fill="#4F46E5" name="Relationships" />
                        <Bar dataKey="confidence" fill="#10B981" name="Confidence %" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-6">
                    <h3 className="text-lg font-semibold mb-4">Pipeline Distribution</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={Object.entries(strategyStats.pipelineDistribution).map(([pipeline, count]) => ({
                            name: pipeline,
                            value: count
                          }))}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          outerRadius={100}
                          fill="#8884d8"
                          dataKey="value"
                          label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                        >
                          {Object.entries(strategyStats.pipelineDistribution).map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* Enhanced ID Mapping Tab */}
            {activeStrategy === 'direct-ids' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-semibold">Enhanced ID-Based Mappings</h3>
                    <p className="text-gray-600 mt-1">
                      Direct company associations using Associated Company IDs (Primary) from {deals.length.toLocaleString()} deals
                    </p>
                  </div>
                  <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium">
                    {directIdMapping.length} mappings found (100% confidence)
                  </span>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
                  <div className="bg-green-50 p-4 rounded-lg">
                    <h4 className="font-medium text-green-900">Direct Matches</h4>
                    <p className="text-2xl font-bold text-green-600">
                      {directIdMapping.length}
                    </p>
                    <p className="text-sm text-green-700">100% confidence via Primary ID</p>
                  </div>
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <h4 className="font-medium text-blue-900">Total Revenue Mapped</h4>
                    <p className="text-2xl font-bold text-blue-600">
                      ${(directIdMapping.reduce((sum, m) => sum + m.amount, 0) / 1000000).toFixed(1)}M
                    </p>
                    <p className="text-sm text-blue-700">Budget-based calculation</p>
                  </div>
                  <div className="bg-orange-50 p-4 rounded-lg">
                    <h4 className="font-medium text-orange-900">Coverage</h4>
                    <p className="text-2xl font-bold text-orange-600">
                      {deals.length > 0 ? ((directIdMapping.length / deals.length) * 100).toFixed(1) : 0}%
                    </p>
                    <p className="text-sm text-orange-700">of total deals</p>
                  </div>
                  <div className="bg-purple-50 p-4 rounded-lg">
                    <h4 className="font-medium text-purple-900">Unique Companies</h4>
                    <p className="text-2xl font-bold text-purple-600">
                      {new Set(directIdMapping.map(m => m.companyId)).size}
                    </p>
                    <p className="text-sm text-purple-700">with deals</p>
                  </div>
                </div>

                {/* Stage distribution for mapped deals */}
                <div className="bg-gray-50 rounded-lg p-6 mb-6">
                  <h3 className="text-lg font-semibold mb-4">Deal Stage Distribution</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart 
                      data={Object.entries(
                        directIdMapping.reduce((acc, deal) => {
                          acc[deal.dealStage] = (acc[deal.dealStage] || 0) + 1;
                          return acc;
                        }, {})
                      ).map(([stage, count]) => ({ stage, count }))
                      .sort((a, b) => b.count - a.count)
                      .slice(0, 10)}
                      layout="horizontal"
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="stage" angle={-45} textAnchor="end" height={100} />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="count" fill="#4F46E5" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Deal</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stage</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pipeline</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Budget</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Brand</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {filteredRelationships
                        .filter(r => r.strategy === 'Enhanced ID')
                        .slice(0, 50)
                        .map((mapping, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900 max-w-xs truncate" title={mapping.dealName}>
                              {mapping.dealName}
                            </div>
                            <div className="text-sm text-gray-500">ID: {mapping.dealId}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900 max-w-xs truncate" title={mapping.companyName}>
                              {mapping.companyName}
                            </div>
                            <div className="text-sm text-gray-500">ID: {mapping.companyId}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                              mapping.isClosedWon 
                                ? 'bg-green-100 text-green-800'
                                : mapping.dealStage?.toLowerCase().includes('lost')
                                ? 'bg-red-100 text-red-800'
                                : 'bg-yellow-100 text-yellow-800'
                            }`}>
                              {mapping.dealStage}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-gray-900">
                              {mapping.pipeline}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            ${mapping.amount?.toLocaleString() || '0'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 max-w-xs truncate" title={mapping.campaignBrand}>
                            {mapping.campaignBrand || 'N/A'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredRelationships.filter(r => r.strategy === 'Enhanced ID').length > 50 && (
                    <div className="text-center py-4 text-sm text-gray-500">
                      Showing 50 of {filteredRelationships.filter(r => r.strategy === 'Enhanced ID').length} mappings
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Domain Analysis Tab */}
            {activeStrategy === 'domain' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-semibold">Domain-Based Relationship Inference</h3>
                  <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
                    {domainMapping.length} relationships found (75% confidence)
                  </span>
                </div>

                {/* Domain stats */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <h4 className="font-medium text-blue-900">Domain Groups</h4>
                    <p className="text-2xl font-bold text-blue-600">
                      {new Set(domainMapping.map(d => d.domain)).size}
                    </p>
                    <p className="text-sm text-blue-700">unique domains</p>
                  </div>
                  <div className="bg-purple-50 p-4 rounded-lg">
                    <h4 className="font-medium text-purple-900">Parent Companies</h4>
                    <p className="text-2xl font-bold text-purple-600">
                      {new Set(domainMapping.map(d => d.parentId)).size}
                    </p>
                    <p className="text-sm text-purple-700">identified</p>
                  </div>
                  <div className="bg-orange-50 p-4 rounded-lg">
                    <h4 className="font-medium text-orange-900">Child Companies</h4>
                    <p className="text-2xl font-bold text-orange-600">
                      {new Set(domainMapping.map(d => d.childId)).size}
                    </p>
                    <p className="text-sm text-orange-700">linked</p>
                  </div>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Parent Company</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Child Company</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Domain</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Parent Deals</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Confidence</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {domainMapping.slice(0, 50).map((rel, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{rel.parentName}</div>
                            <div className="text-sm text-gray-500">ID: {rel.parentId}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{rel.childName}</div>
                            <div className="text-sm text-gray-500">ID: {rel.childId}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {rel.domain}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {rel.parentDealCount || 0}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                              {rel.confidence}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {domainMapping.length > 50 && (
                    <div className="text-center py-4 text-sm text-gray-500">
                      Showing 50 of {domainMapping.length} domain relationships
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Brand Attribution Tab */}
            {activeStrategy === 'brand-attribution' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-semibold">Enhanced Brand-to-Company Revenue Attribution</h3>
                    <p className="text-gray-600 mt-1">
                      Analysis across {brandMapping.totalBrands} brands with ${(brandMapping.totalBrandRevenue / 1000000).toFixed(1)}M total revenue
                    </p>
                  </div>
                  <span className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-sm font-medium">
                    {Object.keys(brandMapping.brandRevenue).length} brands tracked
                  </span>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-gray-50 rounded-lg p-6">
                    <h4 className="text-lg font-medium mb-4">Top Brands by Revenue</h4>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={brandMapping.brandMetrics.slice(0, 10)}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis 
                          dataKey="brand" 
                          angle={-45} 
                          textAnchor="end" 
                          height={100}
                          tick={{ fontSize: 12 }}
                          interval={0}
                        />
                        <YAxis />
                        <Tooltip 
                          formatter={(value, name) => [
                            name === 'revenue' ? `$${value.toLocaleString()}` : value,
                            name === 'revenue' ? 'Revenue' : 'Deal Count'
                          ]} 
                        />
                        <Bar dataKey="revenue" fill="#8B5CF6" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-6">
                    <h4 className="text-lg font-medium mb-4">Brand Win Rate Analysis</h4>
                    <ResponsiveContainer width="100%" height={300}>
                      <ScatterChart data={brandMapping.brandMetrics.filter(b => b.dealCount >= 5)}>
                        <CartesianGrid />
                        <XAxis dataKey="dealCount" name="Deal Count" />
                        <YAxis dataKey="winRate" name="Win Rate %" />
                        <Tooltip 
                          cursor={{ strokeDasharray: '3 3' }}
                          content={({ active, payload }) => {
                            if (active && payload && payload[0]) {
                              const data = payload[0].payload;
                              return (
                                <div className="bg-white p-3 border rounded shadow-lg">
                                  <p className="font-medium">{data.brand}</p>
                                  <p className="text-sm">Win Rate: {data.winRate.toFixed(1)}%</p>
                                  <p className="text-sm">Deals: {data.dealCount}</p>
                                  <p className="text-sm">Revenue: ${(data.revenue / 1000).toFixed(0)}K</p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Scatter name="Brands" dataKey="winRate" fill="#10B981" />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Brand Portfolio Analysis */}
                <div className="bg-gray-50 rounded-lg p-6">
                  <h4 className="text-lg font-medium mb-4">Brand Portfolio Analysis</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-white">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Brand</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Revenue</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Deals</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Deal Size</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Win Rate</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Companies</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {brandMapping.brandMetrics.slice(0, 20).map((brand, index) => (
                          <tr key={index} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-medium text-gray-900 max-w-xs truncate" title={brand.brand}>
                                {brand.brand}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              ${(brand.revenue / 1000).toFixed(0)}K
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {brand.dealCount}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              ${(brand.avgDealSize / 1000).toFixed(0)}K
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                brand.winRate > 50 
                                  ? 'bg-green-100 text-green-800'
                                  : brand.winRate > 25
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : 'bg-red-100 text-red-800'
                              }`}>
                                {brand.winRate.toFixed(1)}%
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {brand.companyCount}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Pipeline distribution for top brands */}
                <div className="bg-gray-50 rounded-lg p-6">
                  <h4 className="text-lg font-medium mb-4">Top Brand Pipeline Distribution</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Object.entries(brandMapping.brandRevenue)
                      .sort(([,a], [,b]) => b - a)
                      .slice(0, 6)
                      .map(([brand, revenue]) => {
                        const pipelines = brandMapping.brandPipelines[brand] || {};
                        return (
                          <div key={brand} className="bg-white p-4 rounded border">
                            <h5 className="font-medium text-gray-900 truncate mb-2" title={brand}>{brand}</h5>
                            <p className="text-sm text-gray-600 mb-2">
                              Revenue: ${(revenue / 1000).toFixed(0)}K
                            </p>
                            <div className="space-y-1">
                              {Object.entries(pipelines)
                                .sort(([,a], [,b]) => b - a)
                                .slice(0, 5)
                                .map(([pipeline, count]) => (
                                <div key={pipeline} className="flex justify-between text-sm">
                                  <span className="text-gray-600 truncate flex-1">{pipeline}</span>
                                  <span className="font-medium ml-2">{count}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>
            )}

            {/* Revenue Validation Tab - Updated */}
            {activeStrategy === 'revenue-validation' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-semibold">Enhanced Revenue Validation Framework</h3>
                    <p className="text-gray-600 mt-1">
                      Analysis with win rates and deal performance metrics across {revenueValidation.length} companies
                    </p>
                  </div>
                  <span className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-sm font-medium">
                    {revenueValidation.length} companies analyzed
                  </span>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-gray-50 rounded-lg p-6">
                    <h4 className="text-lg font-medium mb-4">Media Budget vs Deal Count</h4>
                    <ResponsiveContainer width="100%" height={300}>
                      <ScatterChart data={revenueValidation}>
                        <CartesianGrid />
                        <XAxis dataKey="dealCount" name="Deal Count" />
                        <YAxis dataKey="totalMediaBudget" name="Total Media Budget" tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`} />
                        <Tooltip 
                          cursor={{ strokeDasharray: '3 3' }}
                          content={({ active, payload }) => {
                            if (active && payload && payload[0]) {
                              const data = payload[0].payload;
                              return (
                                <div className="bg-white p-3 border rounded shadow-lg">
                                  <p className="font-medium">{data.companyName}</p>
                                  <p className="text-sm">Deals: {data.dealCount}</p>
                                  <p className="text-sm">Media Budget: ${(data.totalMediaBudget / 1000).toFixed(0)}K</p>
                                  <p className="text-sm">PO Amount: ${(data.totalPOAmount / 1000).toFixed(0)}K</p>
                                  <p className="text-sm">Win Rate: {data.winRate.toFixed(1)}%</p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Scatter name="Companies" dataKey="totalMediaBudget" fill="#F59E0B" />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-6">
                    <h4 className="text-lg font-medium mb-4">Win Rate Distribution</h4>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={revenueValidation
                        .filter(c => c.dealCount >= 3)
                        .sort((a, b) => b.winRate - a.winRate)
                        .slice(0, 10)
                        .map(company => ({
                          name: company.companyName.slice(0, 20) + (company.companyName.length > 20 ? '...' : ''),
                          winRate: company.winRate,
                          deals: company.dealCount,
                          wonDeals: company.wonDeals
                        }))
                      }>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                        <YAxis />
                        <Tooltip formatter={(value, name) => [
                          name === 'winRate' ? `${value.toFixed(1)}%` : value,
                          name === 'winRate' ? 'Win Rate' : name === 'deals' ? 'Total Deals' : 'Won Deals'
                        ]} />
                        <Bar dataKey="winRate" fill="#10B981" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Revenue Summary Stats */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                  <div className="bg-green-50 p-4 rounded-lg">
                    <h4 className="font-medium text-green-900">Total Media Budget</h4>
                    <p className="text-2xl font-bold text-green-600">
                      ${(revenueValidation.reduce((sum, r) => sum + r.totalMediaBudget, 0) / 1000000).toFixed(1)}M
                    </p>
                    <p className="text-sm text-green-700">across all companies</p>
                  </div>
                  <div className="bg-yellow-50 p-4 rounded-lg">
                    <h4 className="font-medium text-yellow-900">Total PO Amount</h4>
                    <p className="text-2xl font-bold text-yellow-600">
                      ${(revenueValidation.reduce((sum, r) => sum + r.totalPOAmount, 0) / 1000000).toFixed(1)}M
                    </p>
                    <p className="text-sm text-yellow-700">all deals</p>
                  </div>
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <h4 className="font-medium text-blue-900">Avg Win Rate</h4>
                    <p className="text-2xl font-bold text-blue-600">
                      {(revenueValidation.reduce((sum, r) => sum + r.winRate, 0) / revenueValidation.length).toFixed(1)}%
                    </p>
                    <p className="text-sm text-blue-700">across companies</p>
                  </div>
                  <div className="bg-purple-50 p-4 rounded-lg">
                    <h4 className="font-medium text-purple-900">Avg PO Amount</h4>
                    <p className="text-2xl font-bold text-purple-600">
                      ${(revenueValidation.reduce((sum, r) => sum + r.avgPOAmount, 0) / revenueValidation.length / 1000).toFixed(0)}K
                    </p>
                    <p className="text-sm text-purple-700">per company</p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Deals</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Win Rate</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Media Budget</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total PO Amount</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Media Budget</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avg PO Amount</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {revenueValidation
                        .sort((a, b) => b.totalMediaBudget - a.totalMediaBudget)
                        .slice(0, 50)
                        .map((validation, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900 max-w-xs truncate" title={validation.companyName}>
                              {validation.companyName}
                            </div>
                            <div className="text-sm text-gray-500">
                              {validation.wonDeals}W / {validation.openDeals}O / {validation.lostDeals}L
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {validation.dealCount}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                              validation.winRate > 50 
                                ? 'bg-green-100 text-green-800'
                                : validation.winRate > 25
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {validation.winRate.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            ${validation.totalMediaBudget.toLocaleString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            ${validation.totalPOAmount.toLocaleString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            ${(validation.avgMediaBudget / 1000).toFixed(0)}K
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            ${(validation.avgPOAmount / 1000).toFixed(0)}K
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {revenueValidation.length > 50 && (
                    <div className="text-center py-4 text-sm text-gray-500">
                      Showing 50 of {revenueValidation.length} companies
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Action Items Footer */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <AlertCircle className="text-orange-500" />
            Recommended Action Items
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="p-4 bg-blue-50 rounded-lg">
              <h4 className="font-medium text-blue-900">Immediate: Enhanced ID Mapping</h4>
              <p className="text-sm text-blue-700 mt-2">
                Leverage {strategyStats.directMappings} direct ID mappings with 100% confidence covering {strategyStats.mappingCoverage.toFixed(1)}% of deals.
              </p>
              <ul className="text-sm text-blue-600 mt-2 space-y-1">
                <li>• {new Set(directIdMapping.map(m => m.companyId)).size} companies with deals</li>
                <li>• ${(directIdMapping.filter(d => !d.isClosedWon).reduce((s, d) => s + d.amount, 0) / 1000000).toFixed(1)}M open pipeline</li>
              </ul>
            </div>
            <div className="p-4 bg-purple-50 rounded-lg">
              <h4 className="font-medium text-purple-900">Short-term: Brand Portfolio Optimization</h4>
              <p className="text-sm text-purple-700 mt-2">
                Optimize {strategyStats.totalBrands} brand relationships with ${(strategyStats.totalRevenue / 1000000).toFixed(1)}M budget-based revenue.
              </p>
              <ul className="text-sm text-purple-600 mt-2 space-y-1">
                <li>• Focus on top 10 brands: ${(brandMapping.brandMetrics.slice(0, 10).reduce((s, b) => s + b.revenue, 0) / 1000000).toFixed(1)}M</li>
                <li>• Average win rate: {(brandMapping.brandMetrics.slice(0, 10).reduce((s, b) => s + b.winRate, 0) / 10).toFixed(1)}%</li>
              </ul>
            </div>
            <div className="p-4 bg-orange-50 rounded-lg">
              <h4 className="font-medium text-orange-900">Long-term: Pipeline Enhancement</h4>
              <p className="text-sm text-orange-700 mt-2">
                Improve {strategyStats.winRate.toFixed(1)}% win rate across {strategyStats.openDeals} open deals using insights.
              </p>
              <ul className="text-sm text-orange-600 mt-2 space-y-1">
                <li>• {revenueValidation.filter(r => r.winRate > 50).length} high-performing companies</li>
                <li>• ${(strategyStats.averageDealSize / 1000).toFixed(0)}K average deal size</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HubSpotRelationshipMapper;