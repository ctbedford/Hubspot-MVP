import React, { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, ScatterChart, Scatter } from 'recharts';
import { Search, Users, Building, DollarSign, Target, Network, AlertCircle, CheckCircle, TrendingUp, Filter } from 'lucide-react';
import Papa from 'papaparse';

const HubSpotRelationshipMapper = () => {
  const [deals, setDeals] = useState([]); // Tyler deals - comprehensive master set
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeStrategy, setActiveStrategy] = useState('overview');
  const [searchTerm, setSearchTerm] = useState('');

  // Load and parse CSV data
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        // Load Tyler deals data (updated to use tylerdeals2.csv)
        let tylerDealsData;
        try {
          tylerDealsData = await window.fs.readFile('tylerdeals2.csv', { encoding: 'utf8' });
        } catch (e) {
          console.error('Error loading tylerdeals2.csv:', e);
          throw new Error('Failed to load tylerdeals2.csv');
        }

        const tylerDealsParsed = Papa.parse(tylerDealsData, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          complete: function(results) {
            if (results.errors.length > 0) {
              console.error("Errors parsing tylerdeals2.csv:", results.errors);
            }
          }
        });

        // Load companies data (updated filename)
        let companiesData;
        try {
          companiesData = await window.fs.readFile('hubspot-crm-exports-tyler-companies-2025-05-29.csv', { encoding: 'utf8' });
        } catch (e) {
          console.error('Error loading hubspot-crm-exports-tyler-companies-2025-05-29.csv:', e);
          throw new Error('Failed to load hubspot-crm-exports-tyler-companies-2025-05-29.csv');
        }

        const companiesParsed = Papa.parse(companiesData, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          complete: function(results) {
            if (results.errors.length > 0) {
              console.error("Errors parsing hubspot-crm-exports-tyler-companies-2025-05-29.csv:", results.errors);
            }
          }
        });

        setDeals(tylerDealsParsed.data || []);
        setCompanies(companiesParsed.data || []);
      } catch (error) {
        console.error('Error in loadData process:', error.message);
        setDeals([]);
        setCompanies([]);
      } finally {
        setLoading(false);
      }
    };

    if (window.fs) {
      loadData();
    } else {
      console.error('window.fs is not available. Ensure you are in an Electron environment or similar.');
      setLoading(false);
    }
  }, []);

  // Strategy 1: Enhanced Relationship Mapping - Direct ID based
  const directIdMapping = useMemo(() => {
    if (!deals.length || !companies.length) return [];

    const mappings = [];
    
    deals.forEach(deal => {
      const primaryCompanyId = deal['Associated Company IDs (Primary)'];
      
      if (primaryCompanyId !== undefined && primaryCompanyId !== null && String(primaryCompanyId).trim() !== '') {
        // Find the matching company by ID
        const company = companies.find(c => String(c['Record ID']) === String(primaryCompanyId));
        
        if (company) {
          mappings.push({
            dealId: deal['Record ID'],
            dealName: deal['Deal Name'],
            companyId: company['Record ID'],
            companyName: company['Company name'],
            relationship: 'primary',
            confidence: 100, // Direct ID match = 100% confidence
            amount: deal['Budget'] || 0, // Always use Budget as specified
            campaignBrand: deal['Campaign Brand'],
            dealStage: deal['Deal Stage'],
            pipeline: deal['Pipeline']
          });
        }
      }
    });

    return mappings;
  }, [deals, companies]);

  // Strategy 2: Domain-Based Relationship Inference
  const domainMapping = useMemo(() => {
    const domainGroups = {};
    
    companies.forEach(company => {
      const domain = company['Company Domain Name'];
      if (domain) {
        const rootDomain = domain.toLowerCase().replace(/^www\./, '').split('.').slice(-2).join('.');
        if (!domainGroups[rootDomain]) {
          domainGroups[rootDomain] = [];
        }
        domainGroups[rootDomain].push(company);
      }
    });

    const relationships = [];
    Object.entries(domainGroups).forEach(([domain, relatedCompanies]) => {
      if (relatedCompanies.length > 1) {
        // Find the "parent" company (highest revenue or earliest created)
        const parent = relatedCompanies.reduce((prev, curr) => {
          const prevRevenue = prev['Total Revenue'] || 0;
          const currRevenue = curr['Total Revenue'] || 0;
          return currRevenue > prevRevenue ? curr : prev;
        });

        relatedCompanies.forEach(company => {
          if (company['Record ID'] !== parent['Record ID']) {
            relationships.push({
              parentId: parent['Record ID'],
              parentName: parent['Company name'],
              childId: company['Record ID'],
              childName: company['Company name'],
              confidence: 75,
              basis: 'domain',
              domain: domain
            });
          }
        });
      }
    });

    return relationships;
  }, [companies]);

  // Strategy 3: Enhanced Brand-to-Company Attribution
  const brandMapping = useMemo(() => {
    const brandRevenue = {};
    const brandCompanies = {};
    const brandDealCounts = {};
    const brandPipelines = {};

    deals.forEach(deal => {
      const brandsRaw = deal['Campaign Brand'];
      const brands = (brandsRaw && typeof brandsRaw === 'string') 
        ? brandsRaw.split(';').map(b => b.trim()).filter(b => b !== '') 
        : [];
      const revenue = deal['Budget'] || 0; // Always use Budget
      const pipeline = deal['Pipeline'] || 'Unknown';
      const primaryCompanyId = deal['Associated Company IDs (Primary)'];
      
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

    return { 
      brandRevenue, 
      brandCompanies, 
      brandDealCounts, 
      brandPipelines,
      totalBrands: Object.keys(brandRevenue).length,
      totalBrandRevenue: Object.values(brandRevenue).reduce((sum, rev) => sum + rev, 0)
    };
  }, [deals]);

  // Strategy 4: Enhanced Revenue Validation
  const revenueValidation = useMemo(() => {
    const companyDealAnalysis = {};
    
    deals.forEach(deal => {
      const primaryCompanyId = deal['Associated Company IDs (Primary)'];
      const dealRevenue = deal['Budget'] || 0; // Always use Budget
      const dealStage = deal['Deal Stage'];
      
      if (primaryCompanyId !== undefined && primaryCompanyId !== null && String(primaryCompanyId).trim() !== '') {
        const company = companies.find(c => String(c['Record ID']) === String(primaryCompanyId));
        
        if (company) {
          const companyId = company['Record ID'];
          
          if (!companyDealAnalysis[companyId]) {
            companyDealAnalysis[companyId] = {
              companyName: company['Company name'],
              declaredRevenue: company['Total Revenue'] || 0,
              calculatedRevenue: 0,
              dealCount: 0,
              wonDeals: 0,
              openDeals: 0,
              deals: []
            };
          }
          
          companyDealAnalysis[companyId].calculatedRevenue += dealRevenue;
          companyDealAnalysis[companyId].dealCount += 1;
          companyDealAnalysis[companyId].deals.push({
            name: deal['Deal Name'],
            stage: dealStage,
            revenue: dealRevenue
          });
          
          if (dealStage && typeof dealStage === 'string' && dealStage.toLowerCase().includes('won')) {
            companyDealAnalysis[companyId].wonDeals += 1;
          } else if (dealStage && typeof dealStage === 'string' && 
                     !dealStage.toLowerCase().includes('lost') && 
                     !dealStage.toLowerCase().includes('won')) {
            companyDealAnalysis[companyId].openDeals += 1;
          }
        }
      }
    });
    
    // Calculate validation metrics
    return Object.entries(companyDealAnalysis).map(([companyId, analysis]) => {
      const variance = Math.abs(analysis.declaredRevenue - analysis.calculatedRevenue);
      const accuracy = analysis.declaredRevenue > 0 ? 
        Math.max(0, 100 - ((variance / analysis.declaredRevenue) * 100)) : 0;
      
      return {
        companyId: parseInt(companyId),
        companyName: analysis.companyName,
        declaredRevenue: analysis.declaredRevenue,
        calculatedRevenue: analysis.calculatedRevenue,
        variance,
        accuracy,
        dealCount: analysis.dealCount,
        wonDeals: analysis.wonDeals,
        openDeals: analysis.openDeals,
        winRate: analysis.dealCount > 0 ? (analysis.wonDeals / analysis.dealCount) * 100 : 0
      };
    }).filter(item => item.calculatedRevenue > 0);
  }, [deals, companies]);

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
    
    return combinedRelationships.filter(rel => 
      rel.dealName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rel.companyName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rel.parentName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rel.childName?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [combinedRelationships, searchTerm]);

  // Enhanced Strategy statistics
  const strategyStats = useMemo(() => {
    const totalDealValue = deals.reduce((sum, deal) => sum + (deal['Budget'] || 0), 0); // Always use Budget
    const closedWonDeals = deals.filter(deal => {
      const stage = deal['Deal Stage'];
      const isWon = deal['Is Closed Won'];
      return (stage && typeof stage === 'string' && stage.toLowerCase().includes('won')) || 
             isWon === true;
    }).length;
    
    const openDeals = deals.filter(deal => {
      const stage = deal['Deal Stage'];
      return stage && typeof stage === 'string' && 
             !stage.toLowerCase().includes('closed') && 
             !stage.toLowerCase().includes('lost') &&
             !stage.toLowerCase().includes('won');
    }).length;
    
    const stats = {
      totalDeals: deals.length,
      totalCompanies: companies.length,
      directMappings: directIdMapping.length,
      domainRelationships: domainMapping.length,
      revenueAccuracy: revenueValidation.filter(r => r.accuracy > 80).length,
      totalRevenue: totalDealValue,
      totalBrands: brandMapping.totalBrands,
      closedWonDeals,
      openDeals,
      winRate: deals.length > 0 ? (closedWonDeals / deals.length) * 100 : 0,
      averageDealSize: deals.length > 0 ? totalDealValue / deals.length : 0,
      pipelineDistribution: {}
    };
    
    // Calculate pipeline distribution
    deals.forEach(deal => {
      const pipeline = deal['Pipeline'];
      const pipelineName = (pipeline && typeof pipeline === 'string') ? pipeline : 'Unknown';
      stats.pipelineDistribution[pipelineName] = (stats.pipelineDistribution[pipelineName] || 0) + 1;
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

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

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
            </div>
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search relationships..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Strategy Tabs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6">
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
                  className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm ${
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
                      <Users className="w-8 h-8 text-blue-200" />
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
                        <p className="text-indigo-100">Avg Deal Size</p>
                        <p className="text-2xl font-bold">${(strategyStats.averageDealSize / 1000).toFixed(0)}K</p>
                        <p className="text-sm text-indigo-200">{strategyStats.openDeals} open deals</p>
                      </div>
                      <TrendingUp className="w-8 h-8 text-indigo-200" />
                    </div>
                  </div>
                </div>

                {/* Strategy Effectiveness Chart */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-gray-50 rounded-lg p-6">
                    <h3 className="text-lg font-semibold mb-4">Strategy Effectiveness</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={[
                        { strategy: 'Enhanced ID Mapping', mappings: strategyStats.directMappings, confidence: 100 },
                        { strategy: 'Domain Analysis', mappings: strategyStats.domainRelationships, confidence: 75 },
                        { strategy: 'Brand Attribution', mappings: strategyStats.totalBrands, confidence: 60 },
                        { strategy: 'Revenue Validation', mappings: strategyStats.revenueAccuracy, confidence: 85 }
                      ]}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="strategy" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="mappings" fill="#4F46E5" />
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
                          {COLORS.map((color, index) => (
                            <Cell key={`cell-${index}`} fill={color} />
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
                
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
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
                </div>
                
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Deal</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pipeline</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Confidence</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Budget</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Brand</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {filteredRelationships.filter(r => r.strategy === 'Enhanced ID').slice(0, 20).map((mapping, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{mapping.dealName}</div>
                            <div className="text-sm text-gray-500">ID: {mapping.dealId}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{mapping.companyName}</div>
                            <div className="text-sm text-gray-500">ID: {mapping.companyId}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">
                              {mapping.pipeline || 'N/A'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                              {mapping.confidence}%
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            ${mapping.amount?.toLocaleString() || '0'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 max-w-xs truncate">
                            {mapping.campaignBrand || 'N/A'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Parent Company</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Child Company</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Domain</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Confidence</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {domainMapping.slice(0, 20).map((rel, index) => (
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
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                              {rel.confidence}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                      <BarChart data={Object.entries(brandMapping.brandRevenue)
                        .sort(([,a], [,b]) => b - a)
                        .slice(0, 10)
                        .map(([brand, revenue]) => ({ 
                          brand: brand.slice(0, 15) + (brand.length > 15 ? '...' : ''), 
                          revenue,
                          deals: brandMapping.brandDealCounts[brand] || 0
                        }))
                      }>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="brand" angle={-45} textAnchor="end" height={100} />
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
                    <h4 className="text-lg font-medium mb-4">Brand Portfolio Analysis</h4>
                    <div className="space-y-3 max-h-[300px] overflow-y-auto">
                      {Object.entries(brandMapping.brandRevenue)
                        .sort(([,a], [,b]) => b - a)
                        .slice(0, 15)
                        .map(([brand, revenue]) => (
                          <div key={brand} className="flex justify-between items-center p-3 bg-white rounded border">
                            <div className="flex-1">
                              <div className="font-medium text-gray-900 truncate">{brand}</div>
                              <div className="text-sm text-gray-500">
                                {brandMapping.brandDealCounts[brand] || 0} deals • {brandMapping.brandCompanies[brand]?.size || 0} companies
                              </div>
                            </div>
                            <div className="text-right ml-4">
                              <div className="font-semibold text-purple-600">
                                ${(revenue / 1000).toFixed(0)}K
                              </div>
                              <div className="text-sm text-gray-500">
                                ${(revenue / (brandMapping.brandDealCounts[brand] || 1) / 1000).toFixed(0)}K avg
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
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
                            <h5 className="font-medium text-gray-900 truncate mb-2">{brand}</h5>
                            <div className="space-y-1">
                              {Object.entries(pipelines).map(([pipeline, count]) => (
                                <div key={pipeline} className="flex justify-between text-sm">
                                  <span className="text-gray-600 truncate">{pipeline}</span>
                                  <span className="font-medium">{count}</span>
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

            {/* Revenue Validation Tab */}
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
                    <h4 className="text-lg font-medium mb-4">Revenue Accuracy vs Deal Count</h4>
                    <ResponsiveContainer width="100%" height={300}>
                      <ScatterChart data={revenueValidation}>
                        <CartesianGrid />
                        <XAxis dataKey="dealCount" name="Deal Count" />
                        <YAxis dataKey="accuracy" name="Accuracy %" />
                        <Tooltip 
                          cursor={{ strokeDasharray: '3 3' }}
                          formatter={(value, name) => [
                            name === 'accuracy' ? `${value.toFixed(1)}%` : value,
                            name === 'accuracy' ? 'Accuracy' : 'Deal Count'
                          ]}
                          labelFormatter={(label) => `Company: ${revenueValidation.find(r => r.dealCount === label)?.companyName || 'Unknown'}`}
                        />
                        <Scatter name="Companies" dataKey="accuracy" fill="#F59E0B" />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-6">
                    <h4 className="text-lg font-medium mb-4">Win Rate Distribution</h4>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={revenueValidation
                        .sort((a, b) => b.winRate - a.winRate)
                        .slice(0, 10)
                        .map(company => ({
                          name: company.companyName.slice(0, 15) + (company.companyName.length > 15 ? '...' : ''),
                          winRate: company.winRate,
                          deals: company.dealCount
                        }))
                      }>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                        <YAxis />
                        <Tooltip formatter={(value, name) => [
                          name === 'winRate' ? `${value.toFixed(1)}%` : value,
                          name === 'winRate' ? 'Win Rate' : 'Total Deals'
                        ]} />
                        <Bar dataKey="winRate" fill="#10B981" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Deals</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Win Rate</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Declared Revenue</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Calculated Revenue</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Accuracy</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {revenueValidation
                        .sort((a, b) => b.calculatedRevenue - a.calculatedRevenue)
                        .slice(0, 15)
                        .map((validation, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{validation.companyName}</div>
                            <div className="text-sm text-gray-500">{validation.wonDeals}W / {validation.openDeals}O</div>
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
                            ${validation.declaredRevenue.toLocaleString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            ${validation.calculatedRevenue.toLocaleString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                              validation.accuracy > 80 
                                ? 'bg-green-100 text-green-800'
                                : validation.accuracy > 50
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {validation.accuracy.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                Leverage {strategyStats.directMappings} direct ID mappings with 100% confidence across {strategyStats.totalDeals.toLocaleString()} deals.
              </p>
            </div>
            <div className="p-4 bg-purple-50 rounded-lg">
              <h4 className="font-medium text-purple-900">Short-term: Brand Portfolio Optimization</h4>
              <p className="text-sm text-purple-700 mt-2">
                Optimize {strategyStats.totalBrands} brand relationships with ${(strategyStats.totalRevenue / 1000000).toFixed(1)}M budget-based revenue opportunity.
              </p>
            </div>
            <div className="p-4 bg-orange-50 rounded-lg">
              <h4 className="font-medium text-orange-900">Long-term: Pipeline Enhancement</h4>
              <p className="text-sm text-orange-700 mt-2">
                Improve {strategyStats.winRate.toFixed(1)}% win rate across {strategyStats.openDeals} open deals using direct company associations.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HubSpotRelationshipMapper;