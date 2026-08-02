with open("ProfileDetailPage.tsx","r",encoding="utf-8")as fin:
 content=fin.read()
 in_template=False
 in_subst=False
 in_dq=False
 in_sq=False
 in_tq=False
 escape=False
 depth=0
 for ch in content:
  if escape:
   escape=False
   continue
  if ch==chr(92):
   escape=True
   continue
  if in_dq:
   if ch==chr(34):in_dq=False
   continue
  if in_sq:
   if ch==chr(39):in_sq=False
   continue
  if in_tq:
   if ch==chr(96):
    in_tq=False
   elif ch==chr(36):
    pass
   elif ch==chr(123):
    if not in_subst:in_subst=True
   elif ch==chr(125):
    if in_subst:in_subst=False
   continue
  if ch==chr(34):in_dq=True
  elif ch==chr(39):in_sq=True
  elif ch==chr(96):in_tq=True
  elif ch==chr(123)and not in_subst:
   depth+=1
  elif ch==chr(125)and not in_subst:
   depth-=1
 print("Final depth:",depth)
