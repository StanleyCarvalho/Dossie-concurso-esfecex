const express=require('express');
const router=express.Router();
const {getStudyMomentum,getOverdueTasks}=require('../services/studyMomentum');

router.get('/api/plano-estudos/momentum',async(req,res)=>{
  const [momentum,overdue]=await Promise.all([
    getStudyMomentum(req.session.userId),
    getOverdueTasks(req.session.userId,12)
  ]);
  res.json({ok:true,momentum,overdue});
});

module.exports=router;
